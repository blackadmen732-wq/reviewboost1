import "server-only";

import type { User } from "@supabase/supabase-js";

import { deriveConnections, type ConnectionCard } from "@/lib/owner/connections";
import { PLAN_CATALOG } from "@/lib/owner/plan-catalog";
import { listLocations, ownerGoogleLinkFlags, readOwnerBilling } from "@/lib/server/owner-data";
import { logger } from "@/lib/server/logger";
import { getSmsProvider } from "@/lib/server/sms/provider";

/**
 * Read the state every Connections card is drawn from.
 *
 * Places and billing come through the owner data layer (RLS as the signed-in
 * owner). Texting is this deployment's configuration: the real provider, the
 * test provider, or none. Sign-in methods are the identities Supabase Auth
 * holds for this user.
 */
export async function readOwnerConnections(orgId: string, user: User): Promise<ConnectionCard[]> {
  const [locations, billing] = await Promise.all([
    listLocations(orgId),
    readOwnerBilling(orgId).catch((error: unknown) => {
      logger.warn("connections.billing_unreadable", { error });
      return null;
    }),
  ]);

  let texting: "live" | "test" | "not_set_up";
  try {
    texting = getSmsProvider().name === "twilio" ? "live" : "test";
  } catch {
    texting = "not_set_up";
  }

  const identities = (user.identities ?? []).map((identity) => identity.provider);
  const fromMetadata = Array.isArray(user.app_metadata?.providers)
    ? (user.app_metadata.providers as unknown[]).filter((value): value is string => typeof value === "string")
    : [];

  return deriveConnections({
    places: locations.map((location) => {
      const flags = ownerGoogleLinkFlags(location.destination?.url ?? null);
      return {
        name: location.name,
        link: flags.googleLinkInvalid
          ? "invalid"
          : !flags.hasGoogleLink
            ? "missing"
            : flags.googleLinkNeedsUpgrade
              ? "needs_upgrade"
              : "set",
      };
    }),
    billing: billing
      ? {
          planName: billing.planId ? PLAN_CATALOG[billing.planId].name : null,
          status: billing.status,
          renewsOn: billing.currentPeriodEnd,
          trialEndsOn: billing.trialEndsAt,
          cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
        }
      : null,
    texting,
    signInMethods: identities.length > 0 ? identities : fromMetadata,
  });
}
