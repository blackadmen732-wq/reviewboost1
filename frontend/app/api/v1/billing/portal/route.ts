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

    // TODO: Look up the Stripe customer ID from the org's subscription record.
    // For now, return an error explaining billing needs to be set up first.
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

async function lookupStripeCustomer(_orgId: string): Promise<string | null> {
  // TODO: Query the subscriptions table for this org's stripe_customer_id.
  // This is populated by the checkout.session.completed webhook.
  return null;
}
