import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { getStripe, isStripeConfigured } from "@/lib/server/billing/stripe";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { publicFrontendUrl } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a Stripe Billing Portal session.
 *
 * Lets an owner manage payment methods, view invoices, and cancel — all
 * through Stripe's hosted UI rather than a custom implementation.
 */
export function POST(request: Request): Promise<Response> {
  return handle(request, "billing.portal", async (requestId) => {
    if (!isStripeConfigured()) {
      throw new ApiError(503, ERROR_CODE.internalError, "Billing is not available yet.");
    }

    const ctx = await requireOrganizationContext(request);
    requireRole(ctx.role, ["owner", "admin"]);

    const stripeCustomerId = await lookupStripeCustomer(ctx.orgId);
    if (!stripeCustomerId) {
      throw new ApiError(404, ERROR_CODE.notFound, "No billing account found. Subscribe to a plan first.");
    }

    const stripe = await getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${publicFrontendUrl()}/settings/billing`,
    });

    return json(request, requestId, 200, { portalUrl: session.url });
  });
}

async function lookupStripeCustomer(orgId: string): Promise<string | null> {
  const { serviceRoleClient } = await import("@/lib/server/supabase");
  const { data, error } = await serviceRoleClient()
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data?.stripe_customer_id) return null;
  return data.stripe_customer_id;
}
