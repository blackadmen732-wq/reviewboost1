import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { handle, json, readJsonBody } from "@/lib/server/http";
import { getStripe, isStripeConfigured } from "@/lib/server/billing/stripe";
import { stripePriceId, type PlanId } from "@/lib/server/billing/plans";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { publicFrontendUrl } from "@/lib/server/env";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CheckoutBody = z.strictObject({
  planId: z.enum(["starter", "growth", "pro"]),
});

/**
 * Create a Stripe Checkout session for the selected plan.
 *
 * Only owners/admins may change the subscription. The org_id is attached to
 * the session metadata so the webhook can map the payment back to the
 * organization — it is never trusted from the client at webhook time.
 */
export function POST(request: Request): Promise<Response> {
  return handle(request, "billing.checkout", async (requestId) => {
    if (!isStripeConfigured()) {
      throw new ApiError(503, ERROR_CODE.internalError, "Billing is not available yet.");
    }

    const ctx = await requireOrganizationContext(request);
    requireRole(ctx.role, ["owner", "admin"]);

    const body = await readJsonBody(request);
    const parsed = CheckoutBody.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "Invalid plan selection.");
    }

    const planId: PlanId = parsed.data.planId;
    const priceId = stripePriceId(planId);
    const stripe = await getStripe();

    const frontendUrl = publicFrontendUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/settings/billing?canceled=true`,
      metadata: {
        org_id: ctx.orgId,
        plan_id: planId,
      },
      subscription_data: {
        metadata: {
          org_id: ctx.orgId,
          plan_id: planId,
        },
      },
    });

    return json(request, requestId, 200, { checkoutUrl: session.url });
  });
}
