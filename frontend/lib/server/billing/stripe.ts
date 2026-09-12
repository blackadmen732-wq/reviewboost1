import "server-only";

import { ConfigError } from "@/lib/server/env";

/**
 * Stripe client — lazy singleton.
 *
 * The Stripe SDK is loaded dynamically so the build does not fail when the
 * package is not installed (it's an optional dependency during early
 * development). In production, `STRIPE_SECRET_KEY` must be set.
 */

let _stripe: import("stripe").default | null = null;
let _initAttempted = false;

export function stripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new ConfigError(
      "STRIPE_SECRET_KEY is required for billing. " +
        "Get it from https://dashboard.stripe.com/apikeys",
    );
  }
  return key;
}

export function stripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new ConfigError(
      "STRIPE_WEBHOOK_SECRET is required. " +
        "Get it from Stripe Dashboard → Webhooks → Signing secret.",
    );
  }
  return secret;
}

export async function getStripe(): Promise<import("stripe").default> {
  if (_initAttempted && _stripe) return _stripe;
  _initAttempted = true;

  const Stripe = (await import("stripe")).default;
  _stripe = new Stripe(stripeSecretKey(), {
    typescript: true,
  });

  return _stripe;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}
