import "server-only";

import Stripe from "stripe";

import { stripeSecretKey } from "@/lib/server/env";

/**
 * The Stripe client.
 *
 * Built lazily, so a build does not need a key and a request that needs one
 * fails loudly rather than quietly doing nothing. There is no fake mode here:
 * a billing path that pretends to work is how a business ends up believing it
 * is subscribed when no money has moved. Tests inject their own client.
 */

let client: Stripe | undefined;

export function stripeClient(): Stripe {
  client ??= new Stripe(stripeSecretKey(), {
    // Pinned. An API version that moves under a running deployment changes
    // what a webhook payload means without any code changing.
    apiVersion: "2026-08-26.dahlia",
    typescript: true,
    maxNetworkRetries: 2,
  });
  return client;
}

/** Tests replace the client; nothing in production calls this. */
export function __setStripeClientForTests(replacement: Stripe | undefined): void {
  client = replacement;
}
