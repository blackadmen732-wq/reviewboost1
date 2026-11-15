import "server-only";

import { z } from "zod";
import type { OrganizationContext } from "@/lib/server/auth";
import { requireRole } from "@/lib/server/auth";
import { decrypt, digestRequestBody, digestSessionToken, digestSessionTokenWithPreviousKey,
  digestStandToken, digestStandTokenWithPreviousKey, encrypt, generateToken, keyedDigest,
  clientFingerprint } from "@/lib/server/crypto";
import { tokenDigestKey, previousTokenDigestKey } from "@/lib/server/env";
import { ApiError, ERROR_CODE, rateLimited } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import { canonicalJson } from "@/lib/server/validation";
import type { RequestMeta } from "@/lib/server/customer-flow-service";
import { DEFAULT_PROGRAM, decideEngagement, type EngagementProgram } from "./decision";

export const programSchema = z.strictObject({
  enabled: z.boolean(), loyaltyEnabled: z.boolean(), remindersEnabled: z.boolean(),
  stampsRequired: z.number().int().min(2).max(100), rewardLabel: z.string().trim().min(1).max(120),
});

export function memberDigests(token: string) {
  const previous = previousTokenDigestKey();
  return {
    p_member_hash: keyedDigest(token, "loyalty_member", tokenDigestKey()),
    p_previous_member_hash: previous ? keyedDigest(token, "loyalty_member", previous) : null,
  };
}

export function engagementFailure(error: { message?: string } | null): never {
  const message = error?.message ?? "";
  if (message.includes("session_unavailable"))
    throw new ApiError(404, ERROR_CODE.sessionInvalid, "This session is no longer available.");
  if (message.includes("not_found_or_forbidden"))
    throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
  if (message.includes("conflict")) throw new ApiError(409, ERROR_CODE.idempotencyConflict, "This reference was already used with different data.");
  if (message.includes("program_disabled") || message.includes("membership_withdrawn") || message.includes("reward_unavailable"))
    throw new ApiError(409, ERROR_CODE.validationFailed, "This loyalty action is not currently available.");
  logger.error("engagement.database_error", { error });
  throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}

export async function getProgram(context: OrganizationContext): Promise<EngagementProgram> {
  const { data, error } = await context.db.from("engagement_programs")
    .select("enabled,loyaltyEnabled:loyalty_enabled,remindersEnabled:reminders_enabled,stampsRequired:stamps_required,rewardLabel:reward_label")
    .eq("org_id", context.orgId).maybeSingle();
  if (error) engagementFailure(error);
  if (!data) return { ...DEFAULT_PROGRAM };
  const parsed = programSchema.safeParse(data);
  if (!parsed.success) engagementFailure(null);
  return parsed.data;
}

export async function setProgram(context: OrganizationContext, program: EngagementProgram): Promise<void> {
  requireRole(context.role, ["owner", "admin"]);
  const { error } = await context.db.rpc("rpc_set_engagement_program", {
    p_org_id: context.orgId, p_enabled: program.enabled, p_loyalty_enabled: program.loyaltyEnabled,
    p_reminders_enabled: program.remindersEnabled, p_stamps_required: program.stampsRequired,
    p_reward_label: program.rewardLabel,
  });
  if (error) engagementFailure(error);
}

async function guardPublic(meta: RequestMeta): Promise<void> {
  const { data, error } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
    p_bucket: "loyalty-public", p_bucket_key: clientFingerprint(meta.address, meta.userAgent),
    p_limit: 30, p_window_seconds: 300,
  });
  if (error || !Array.isArray(data) || !data[0]?.allowed) throw rateLimited(30);
}

export async function enrollLoyalty(token: string, sessionId: string, remindersConsent: boolean, meta: RequestMeta) {
  await guardPublic(meta);
  const memberToken = generateToken();
  const { data, error } = await serviceRoleClient().rpc("rpc_public_enroll_loyalty", {
    p_token_hash: digestStandToken(token), p_previous_token_hash: digestStandTokenWithPreviousKey(token),
    p_session_hash: digestSessionToken(sessionId), p_previous_session_hash: digestSessionTokenWithPreviousKey(sessionId),
    p_member_hash: keyedDigest(memberToken, "loyalty_member", tokenDigestKey()),
    p_member_encrypted: encrypt(memberToken), p_enrollment_hash: digestRequestBody(canonicalJson({ remindersConsent })),
    p_reminders_consent: remindersConsent,
  });
  if (error || !data) engagementFailure(error);
  const decoded = z.strictObject({ memberId: z.uuid(), memberTokenEncrypted: z.string(),
    stamps: z.number().int().nonnegative(), rewards: z.number().int().nonnegative(),
    walletDelivery: z.literal("not_configured") }).safeParse(data);
  if (!decoded.success) engagementFailure(null);
  const recovered = decrypt(decoded.data.memberTokenEncrypted);
  if (!recovered) engagementFailure(null);
  return { memberToken: recovered, stamps: decoded.data.stamps, rewards: decoded.data.rewards, walletDelivery: "not_configured" as const };
}

export async function withdrawLoyalty(memberToken: string, meta: RequestMeta): Promise<void> {
  await guardPublic(meta);
  const { error } = await serviceRoleClient().rpc("rpc_public_withdraw_loyalty", {
    ...memberDigests(memberToken),
  });
  if (error) engagementFailure(error);
}

export async function previewMember(context: OrganizationContext, memberId: string) {
  requireRole(context.role, ["owner", "admin"]);
  const program = await getProgram(context);
  const { data: member, error } = await context.db.from("loyalty_members")
    .select("id,stamps,rewards,reminders_consent,withdrawn_at,created_at,last_marketing_delivered_at")
    .eq("org_id", context.orgId).eq("id", memberId).maybeSingle();
  if (error) engagementFailure(error);
  if (!member) throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
  const { data: org, error: orgError } = await context.db.from("organizations").select("timezone").eq("id", context.orgId).single();
  if (orgError || !org) engagementFailure(orgError);
  const { data: purchase, error: purchaseError } = await context.db.from("loyalty_transactions")
    .select("created_at").eq("org_id", context.orgId).eq("member_id", memberId).eq("kind", "earn")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (purchaseError) engagementFailure(purchaseError);
  return decideEngagement(context.orgId, program, {
    id: member.id as string, stamps: member.stamps as number, rewards: member.rewards as number,
    remindersConsent: member.reminders_consent as boolean, withdrawn: member.withdrawn_at !== null,
    joinedAt: member.created_at as string, lastPurchaseAt: purchase?.created_at as string ?? null,
    lastDeliveredAt: member.last_marketing_delivered_at as string | null,
  }, org.timezone as string);
}
