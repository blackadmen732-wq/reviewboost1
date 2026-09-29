import "server-only";

import { opsAlertWebhookUrl } from "@/lib/server/env";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Operational health: the failures that grow silently.
 *
 * None of these raises an error on its own. An outbox that stopped draining,
 * a send whose outcome the provider never confirmed, a Twilio webhook that
 * failed to process, a pack someone paid for that minted nothing — each is
 * money or a missed message, and each is only visible if something counts it.
 *
 * `rpc_ops_health` does the counting in one read. This file decides what
 * counts as a problem. Thresholds are configurable because the right one
 * depends on the scheduler's cadence (docs/SCHEDULING.md): a once-a-day
 * dispatcher legitimately leaves work due for hours.
 */

export type ProblemCode =
  | "dispatch_stalled"
  | "dispatch_leases_expired"
  | "dispatch_stuck_sending"
  | "dead_letters"
  | "dead_letters_unreleased"
  | "provider_unknown_backlog"
  | "sms_webhooks_failed"
  | "sms_webhooks_unverified"
  | "stripe_webhooks_unprocessed"
  | "pack_paid_without_credit"
  | "pack_refund_needs_review"
  | "pack_refund_without_payment"
  | "pack_reconciliation_stale"
  | "pack_reconciliation_findings";

export interface HealthReport {
  ok: boolean;
  problems: ProblemCode[];
  signals: HealthSignals;
}

export interface HealthSignals {
  dispatch: {
    duePending: number;
    oldestDueAgeSeconds: number;
    expiredLeases: number;
    stuckSending: number;
  };
  deadLetters: { total: number; last24h: number; unreleased: number };
  providerUnknown: { count: number; oldestAgeSeconds: number };
  smsWebhooks: { failed: number; stuck: number; unverifiedLastHour: number };
  stripeWebhooks: { unprocessed: number; oldestUnprocessedAgeSeconds: number };
  packs: {
    paidWithoutCredit: number;
    needsReview: number;
    needsReviewSegments: number;
    refundWithoutPayment: number;
  };
  reconciliation: {
    lastRunAt: string | null;
    lastOkAt: string | null;
    lastFindings: number;
    lastHealed: number;
  };
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Defaults assume the production cadence: dispatch every minute. */
export function healthThresholds() {
  return {
    dispatchStallSeconds: seconds("OPS_DISPATCH_STALL_SECONDS", 600),
    providerUnknownMaxAgeSeconds: seconds("OPS_PROVIDER_UNKNOWN_MAX_AGE_SECONDS", 3600),
    stripeWebhookMaxAgeSeconds: seconds("OPS_STRIPE_WEBHOOK_MAX_AGE_SECONDS", 900),
    unverifiedWebhooksPerHour: seconds("OPS_UNVERIFIED_WEBHOOKS_PER_HOUR", 10),
    reconciliationMaxAgeSeconds: seconds("OPS_RECONCILIATION_MAX_AGE_SECONDS", 36 * 60 * 60),
  };
}

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function s(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

type Json = Record<string, Record<string, unknown> | undefined>;

export function parseSignals(raw: unknown): HealthSignals {
  const j = (raw && typeof raw === "object" ? raw : {}) as Json;
  const d = j["dispatch"] ?? {};
  const dl = j["deadLetters"] ?? {};
  const pu = j["providerUnknown"] ?? {};
  const sw = j["smsWebhooks"] ?? {};
  const st = j["stripeWebhooks"] ?? {};
  const pk = j["packs"] ?? {};
  const rc = j["reconciliation"] ?? {};

  return {
    dispatch: {
      duePending: n(d["duePending"]),
      oldestDueAgeSeconds: n(d["oldestDueAgeSeconds"]),
      expiredLeases: n(d["expiredLeases"]),
      stuckSending: n(d["stuckSending"]),
    },
    deadLetters: { total: n(dl["total"]), last24h: n(dl["last24h"]), unreleased: n(dl["unreleased"]) },
    providerUnknown: { count: n(pu["count"]), oldestAgeSeconds: n(pu["oldestAgeSeconds"]) },
    smsWebhooks: {
      failed: n(sw["failed"]),
      stuck: n(sw["stuck"]),
      unverifiedLastHour: n(sw["unverifiedLastHour"]),
    },
    stripeWebhooks: {
      unprocessed: n(st["unprocessed"]),
      oldestUnprocessedAgeSeconds: n(st["oldestUnprocessedAgeSeconds"]),
    },
    packs: {
      paidWithoutCredit: n(pk["paidWithoutCredit"]),
      needsReview: n(pk["needsReview"]),
      needsReviewSegments: n(pk["needsReviewSegments"]),
      refundWithoutPayment: n(pk["refundWithoutPayment"]),
    },
    reconciliation: {
      lastRunAt: s(rc["lastRunAt"]),
      lastOkAt: s(rc["lastOkAt"]),
      lastFindings: n(rc["lastFindings"]),
      lastHealed: n(rc["lastHealed"]),
    },
  };
}

/**
 * Signals in, problems out. Pure, so the thresholds are testable without a
 * database.
 */
export function evaluateHealth(
  signals: HealthSignals,
  options: { now?: Date; reconciliationExpected?: boolean } = {},
): HealthReport {
  const t = healthThresholds();
  const now = options.now ?? new Date();
  const problems: ProblemCode[] = [];

  if (signals.dispatch.oldestDueAgeSeconds > t.dispatchStallSeconds) problems.push("dispatch_stalled");
  if (signals.dispatch.expiredLeases > 0) problems.push("dispatch_leases_expired");
  if (signals.dispatch.stuckSending > 0) problems.push("dispatch_stuck_sending");

  if (signals.deadLetters.last24h > 0) problems.push("dead_letters");
  if (signals.deadLetters.unreleased > 0) problems.push("dead_letters_unreleased");

  if (signals.providerUnknown.oldestAgeSeconds > t.providerUnknownMaxAgeSeconds) {
    problems.push("provider_unknown_backlog");
  }

  if (signals.smsWebhooks.failed > 0 || signals.smsWebhooks.stuck > 0) {
    problems.push("sms_webhooks_failed");
  }
  // A burst of unverifiable Twilio webhooks is either someone forging them or
  // an auth token / public URL that no longer matches — in which case every
  // real STOP and delivery receipt is being rejected.
  if (signals.smsWebhooks.unverifiedLastHour > t.unverifiedWebhooksPerHour) {
    problems.push("sms_webhooks_unverified");
  }

  if (signals.stripeWebhooks.oldestUnprocessedAgeSeconds > t.stripeWebhookMaxAgeSeconds) {
    problems.push("stripe_webhooks_unprocessed");
  }

  if (signals.packs.paidWithoutCredit > 0) problems.push("pack_paid_without_credit");
  if (signals.packs.needsReview > 0) problems.push("pack_refund_needs_review");
  if (signals.packs.refundWithoutPayment > 0) problems.push("pack_refund_without_payment");

  if (options.reconciliationExpected ?? true) {
    const lastOk = signals.reconciliation.lastOkAt ? Date.parse(signals.reconciliation.lastOkAt) : NaN;
    const lastRun = signals.reconciliation.lastRunAt ? Date.parse(signals.reconciliation.lastRunAt) : NaN;
    if (Number.isNaN(lastRun) || (now.getTime() - lastRun) / 1000 > t.reconciliationMaxAgeSeconds) {
      problems.push("pack_reconciliation_stale");
    } else if (
      Number.isNaN(lastOk) ||
      lastOk < lastRun ||
      signals.reconciliation.lastFindings > 0 ||
      signals.reconciliation.lastHealed > 0
    ) {
      problems.push("pack_reconciliation_findings");
    }
  }

  return { ok: problems.length === 0, problems, signals };
}

/** Whether pack reconciliation is expected to have run in this deployment. */
export function reconciliationExpected(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export async function readHealth(now?: Date): Promise<HealthReport> {
  const { data, error } = await serviceRoleClient().rpc("rpc_ops_health");
  if (error) throw error;
  return evaluateHealth(parseSignals(data), {
    ...(now ? { now } : {}),
    reconciliationExpected: reconciliationExpected(),
  });
}

/**
 * Raise an alert for what is wrong.
 *
 * Always a structured `ops.alert` error log — the thing a log drain alerts
 * on. When `OPS_ALERT_WEBHOOK_URL` is configured, also a POST of `{ text }`,
 * which Slack-compatible incoming webhooks accept. Counts and codes only;
 * nothing that identifies a customer or a business. Never throws: an alert
 * that fails must not take the maintenance run down with it.
 */
export async function raiseAlerts(report: HealthReport, source: string): Promise<boolean> {
  if (report.ok) return false;

  logger.error("ops.alert", { source, problems: report.problems, signals: report.signals });

  let url: string | null;
  try {
    url = opsAlertWebhookUrl();
  } catch (error) {
    logger.error("ops.alert_misconfigured", { error });
    return false;
  }
  if (!url) return false;

  const text =
    `ReviewBoost ${source}: ${report.problems.length} problem(s) — ${report.problems.join(", ")}.` +
    ` Outbox due ${report.signals.dispatch.duePending} (oldest ${report.signals.dispatch.oldestDueAgeSeconds}s),` +
    ` dead letters 24h ${report.signals.deadLetters.last24h},` +
    ` provider_unknown ${report.signals.providerUnknown.count},` +
    ` Twilio webhooks failed ${report.signals.smsWebhooks.failed + report.signals.smsWebhooks.stuck},` +
    ` packs paid without credit ${report.signals.packs.paidWithoutCredit},` +
    ` refunded-and-spent segments ${report.signals.packs.needsReviewSegments}.`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      logger.error("ops.alert_delivery_failed", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    logger.error("ops.alert_delivery_failed", { error });
    return false;
  }
}
