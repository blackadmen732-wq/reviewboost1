import "server-only";

import { PLANS, type PlanId, type PlanDefinition } from "./plans";

/**
 * Server-authoritative entitlement checks.
 *
 * The architecture:
 *   Stripe → webhook → subscription state in DB → entitlement projection → here
 *
 * This module resolves what an organization is allowed to do, based on their
 * active plan. The frontend reflects this state; it never decides it.
 */

export interface Entitlements {
  plan: PlanDefinition;
  canCreateLocation: (currentCount: number) => boolean;
  canCreateTag: (currentCount: number) => boolean;
  canAddTeamMember: (currentCount: number) => boolean;
  canUseSms: boolean;
  canUseCustomBranding: boolean;
  canUseApi: boolean;
  smsCreditsPerMonth: number;
}

export function entitlementsForPlan(planId: PlanId): Entitlements {
  const plan = PLANS[planId];
  return {
    plan,
    canCreateLocation: (current) => current < plan.limits.locations,
    canCreateTag: (current) => current < plan.limits.tags,
    canAddTeamMember: (current) => current < plan.limits.teamMembers,
    canUseSms: plan.features.smsTextRequests,
    canUseCustomBranding: plan.features.customBranding,
    canUseApi: plan.features.apiAccess,
    smsCreditsPerMonth: plan.limits.smsCreditsPerMonth,
  };
}

/**
 * Resolve entitlements for an organization.
 *
 * In the full implementation this reads the subscription from the database.
 * For now it falls back to "starter" when no subscription exists, which is
 * the correct default: a new business gets the free tier's limits until they
 * upgrade.
 */
export async function resolveEntitlements(
  _orgId: string,
  subscriptionPlanId?: PlanId,
): Promise<Entitlements> {
  const planId = subscriptionPlanId ?? "starter";
  return entitlementsForPlan(planId);
}
