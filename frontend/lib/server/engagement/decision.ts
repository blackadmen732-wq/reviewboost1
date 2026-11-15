import "server-only";

import { createHash } from "node:crypto";

export interface EngagementProgram {
  enabled: boolean;
  loyaltyEnabled: boolean;
  remindersEnabled: boolean;
  stampsRequired: number;
  rewardLabel: string;
}

export const DEFAULT_PROGRAM: EngagementProgram = {
  enabled: false,
  loyaltyEnabled: false,
  remindersEnabled: false,
  stampsRequired: 10,
  rewardLabel: "Your next reward",
};

export interface MemberContext {
  id: string;
  stamps: number;
  rewards: number;
  remindersConsent: boolean;
  withdrawn: boolean;
  joinedAt: string;
  lastPurchaseAt: string | null;
  lastDeliveredAt: string | null;
}

export type EngagementDecision =
  | { kind: "suppressed"; reason: string }
  | { kind: "draft"; campaign: "reward_ready" | "one_visit_away" | "return_visit";
      title: string; body: string; cta: "Open your loyalty card"; delivery: "not_configured" };

/** Draft generation only. No Google review state, private rating, identity
 * guessing, or invented discounts enter this function. A future sender must
 * recheck these gates with fresh state, enforce provider rules, and only mark
 * delivery after the provider accepts the operation. */
export function decideEngagement(
  orgId: string,
  program: EngagementProgram,
  member: MemberContext,
  timezone: string,
  now = new Date(),
): EngagementDecision {
  const suppress = (reason: string): EngagementDecision => ({ kind: "suppressed", reason });
  if (!program.enabled || !program.loyaltyEnabled || !program.remindersEnabled) return suppress("disabled");
  if (member.withdrawn || !member.remindersConsent) return suppress("no_consent");
  if (!Number.isInteger(member.stamps) || member.stamps < 0 || !Number.isInteger(member.rewards)
    || member.rewards < 0 || !Number.isInteger(program.stampsRequired) || program.stampsRequired < 2
    || !Number.isFinite(now.getTime())) return suppress("invalid_state");

  // A stable 10% control group permits measuring repeat purchases against a
  // baseline. Assignment is per business/member, never per request.
  const bucket = createHash("sha256").update(`${orgId}:${member.id}`).digest().readUInt32BE(0) % 100;
  if (bucket < 10) return suppress("control_group");

  if (member.lastDeliveredAt !== null) {
    const last = Date.parse(member.lastDeliveredAt);
    if (!Number.isFinite(last)) return suppress("invalid_state");
    if (now.getTime() - last < 7 * 86_400_000) return suppress("weekly_frequency_limit");
  }
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  } catch { return suppress("invalid_timezone"); }
  if (hour < 9 || hour >= 20) return suppress("quiet_hours");

  const draft = (campaign: "reward_ready" | "one_visit_away" | "return_visit", title: string, body: string): EngagementDecision =>
    ({ kind: "draft", campaign, title, body, cta: "Open your loyalty card", delivery: "not_configured" });
  if (member.rewards > 0) return draft("reward_ready", "Your reward is ready", `${program.rewardLabel}. Open your card to see your available reward.`);
  if (program.stampsRequired - member.stamps === 1) return draft("one_visit_away", "One visit away", "One more qualifying purchase earns your next reward.");
  const previousVisit = Date.parse(member.lastPurchaseAt ?? member.joinedAt);
  if (!Number.isFinite(previousVisit) || previousVisit > now.getTime()) return suppress("invalid_state");
  if (now.getTime() - previousVisit >= 14 * 86_400_000) return draft("return_visit", "Your next visit counts", "Your loyalty card is ready for your next qualifying purchase.");
  return suppress("no_relevant_message");
}
