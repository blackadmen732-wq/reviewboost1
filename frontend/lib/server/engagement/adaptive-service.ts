import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { OrganizationContext } from "@/lib/server/auth";
import { requireRole } from "@/lib/server/auth";
import { engagementFailure, getProgram } from "./service";
import { chooseVariant, observedRate } from "./bandit";
import {
  deliveryProviders,
  googleObjectId,
  GoogleWalletProvider,
  type DeliveryJob,
  type DeliveryProvider,
  type DeliveryResult,
} from "./providers";
import { serviceRoleClient } from "@/lib/server/supabase";
import { logger } from "@/lib/server/logger";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";

export const campaignSchema = z.enum([
  "reward_ready",
  "one_visit_away",
  "return_visit",
]);
const contextSchema = z.object({
  orgId: z.uuid(),
  timezone: z.string(),
  program: z.unknown(),
  experiments: z.array(
    z.object({
      id: z.uuid(),
      campaign: campaignSchema,
      active: z.boolean(),
      arms: z.array(
        z.object({
          id: z.string(),
          wins: z.number().int().nonnegative(),
          losses: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
  members: z.array(
    z.object({
      id: z.uuid(),
      campaign: campaignSchema,
      providers: z.array(z.enum(["google_wallet", "webhook"])),
    }),
  ),
});

export async function prepareEngagement(
  db: SupabaseClient,
  orgId: string,
  worker = false,
  providers = deliveryProviders(),
) {
  const configured = new Set(providers.map((p) => p.name));
  const { data, error } = await db.rpc(
    worker ? "rpc_engagement_worker_context" : "rpc_engagement_context",
    { p_org_id: orgId, p_limit: worker ? 3 : 20 },
  );
  if (error) engagementFailure(error);
  if (data === null)
    return { queued: 0, control: 0, suppressed: 0, deferred: 0 };
  const parsed = contextSchema.safeParse(data);
  if (!parsed.success) engagementFailure(null);
  const summary = { queued: 0, control: 0, suppressed: 0, deferred: 0 };
  for (const member of parsed.data.members) {
    const experiment = parsed.data.experiments.find(
      (e) => e.active && e.campaign === member.campaign,
    );
    const provider = member.providers.find((p) => configured.has(p));
    if (!experiment || !provider) {
      summary.deferred++;
      continue;
    }
    const selected = chooseVariant(experiment.arms);
    const { data: assigned, error: assignmentError } = await db.rpc(
      worker ? "rpc_reserve_engagement_worker" : "rpc_reserve_engagement",
      {
        p_org_id: orgId,
        p_member_id: member.id,
        p_experiment_id: experiment.id,
        p_variant: selected.variant,
        p_source: selected.source,
        p_snapshot: selected.snapshot,
        p_provider: provider,
      },
    );
    if (assignmentError) engagementFailure(assignmentError);
    const assignment = z
      .object({ state: z.string(), replayed: z.boolean().optional() })
      .safeParse(assigned);
    if (!assignment.success) engagementFailure(null);
    if (assignment.data.replayed) summary.suppressed++;
    else if (assignment.data.state === "queued") summary.queued++;
    else if (assignment.data.state === "control") summary.control++;
    else summary.suppressed++;
  }
  return summary;
}

export async function bindDestination(
  context: OrganizationContext,
  memberId: string,
  provider: "google_wallet" | "webhook",
  active: boolean,
) {
  requireRole(context.role, ["owner", "admin"]);
  // Prove membership before making any provider call or returning existence.
  const { data: member, error } = await context.db
    .from("loyalty_members")
    .select("id")
    .eq("org_id", context.orgId)
    .eq("id", memberId)
    .maybeSingle();
  if (error) engagementFailure(error);
  if (!member) engagementFailure({ message: "not_found_or_forbidden" });
  let target = memberId;
  if (provider === "google_wallet" && active) {
    try {
      target = googleObjectId(context.orgId, memberId);
      if (
        !(await new GoogleWalletProvider().passIsSaved(context.orgId, memberId))
      )
        throw new ApiError(
          409,
          ERROR_CODE.validationFailed,
          "The customer has not saved this Google Wallet pass.",
        );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        ERROR_CODE.serviceUnavailable,
        "Google Wallet could not verify this pass. Check your connection and try again.",
      );
    }
  }
  const { error: writeError } = await context.db.rpc(
    "rpc_bind_engagement_destination",
    {
      p_org_id: context.orgId,
      p_member_id: memberId,
      p_provider: provider,
      p_target: target,
      p_active: active,
    },
  );
  if (writeError) engagementFailure(writeError);
}

export interface CohortReport {
  cohort: string;
  assigned: number;
  matured: number;
  converted: number;
  provider_accepted: number;
  unknown_sends: number;
}
export interface ExperimentReport {
  id: string;
  campaign: z.infer<typeof campaignSchema>;
  active: boolean;
  cohorts: CohortReport[];
  variants: Array<{ variant: string; matured: number; converted: number }>;
}
export interface AdaptiveReport {
  experiments: ExperimentReport[];
  recent: Array<{
    id: string;
    cohort: string;
    variant: string | null;
    state: string;
    title: string | null;
    assigned_at: string;
    observe_until: string;
  }>;
  members: Array<{
    id: string;
    stamps: number;
    rewards: number;
    reminders_consent: boolean;
    destinations: Array<{ provider: string; active: boolean }>;
  }>;
  eventCounts: Record<string, number>;
}

export async function readAdaptiveReport(context: OrganizationContext) {
  requireRole(context.role, ["owner", "admin"]);
  const [program, result] = await Promise.all([
    getProgram(context),
    context.db.rpc("rpc_engagement_experiment_report", {
      p_org_id: context.orgId,
    }),
  ]);
  if (result.error || !result.data) engagementFailure(result.error);
  const report = result.data as AdaptiveReport;
  // Guard against a broken report rather than turning missing records into zeros.
  if (
    !Array.isArray(report.experiments) ||
    !Array.isArray(report.recent) ||
    !Array.isArray(report.members) ||
    !report.eventCounts
  )
    engagementFailure(null);
  return {
    program,
    ...report,
    configuredProviders: deliveryProviders().map((p) => p.name),
    rates: report.experiments.map((e) => ({
      id: e.id,
      cohorts: e.cohorts.map((c) => ({
        ...c,
        ...observedRate(c.converted, c.matured),
      })),
    })),
  };
}

const jobSchema = z.object({
  id: z.uuid(),
  leaseToken: z.uuid(),
  orgId: z.uuid(),
  memberId: z.uuid(),
  provider: z.enum(["google_wallet", "webhook"]),
  target: z.string(),
  title: z.string(),
  body: z.string(),
});

export async function dispatchEngagement(
  providers: DeliveryProvider[] = deliveryProviders(),
  db = serviceRoleClient(),
) {
  const summary = { accepted: 0, rejected: 0, unknown: 0 };
  if (!providers.length) return { ...summary, configured: false };
  const { data, error } = await db.rpc("rpc_claim_engagement", {
    p_limit: 3,
    p_providers: providers.map((p) => p.name),
  });
  if (error) engagementFailure(error);
  const jobs = z.array(jobSchema).safeParse(data);
  if (!jobs.success) engagementFailure(null);
  for (const job of jobs.data) {
    let result: DeliveryResult;
    const provider = providers.find((p) => p.name === job.provider)!;
    try {
      result = await provider.send(job as DeliveryJob);
    } catch {
      result = { state: "unknown", code: "provider_response_unknown" };
    }
    // A database failure after provider acceptance is not permission to retry
    // the provider. The expired lease will become unknown on the next sweep.
    const { data: finished, error: finishError } = await db.rpc(
      "rpc_finish_engagement",
      {
        p_id: job.id,
        p_lease: job.leaseToken,
        p_result: result.state,
        p_reference: result.state === "accepted" ? result.reference : null,
        p_failure_code: result.state === "accepted" ? null : result.code,
      },
    );
    if (finishError || finished !== true) {
      logger.error("engagement.receipt_not_recorded", { assignmentId: job.id });
      summary.unknown++;
    } else summary[result.state]++;
  }
  return { ...summary, configured: true };
}

export async function runEngagementWorker() {
  const providers = deliveryProviders();
  if (!providers.length)
    return {
      configured: false,
      prepared: 0,
      accepted: 0,
      rejected: 0,
      unknown: 0,
    };
  const db = serviceRoleClient();
  const { data, error } = await db.rpc("rpc_engagement_active_orgs", {
    p_limit: 1,
  });
  if (error) engagementFailure(error);
  const orgs = z.array(z.uuid()).safeParse(data);
  if (!orgs.success) engagementFailure(null);
  let prepared = 0;
  for (const orgId of orgs.data)
    prepared += (await prepareEngagement(db, orgId, true, providers)).queued;
  return { prepared, ...(await dispatchEngagement(providers, db)) };
}

export function engagementWorkerAuthorized(request: Request): boolean {
  const secrets = [
    process.env.ENGAGEMENT_WORKER_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => typeof s === "string" && s.length >= 32);
  if (!secrets.length) return false;
  const match = /^Bearer ([^ ]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) return false;
  const a = Buffer.from(match[1]!);
  return secrets.some((secret) => {
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
