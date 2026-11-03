/**
 * Product switches. One for now.
 *
 * TEXTING
 * -------
 * Text Requests, customer lists (Connections) and extra-text packs are built
 * and tested, and switched OFF until the owner decides to launch them. What
 * ReviewBoost sells first is the Tag: a customer taps, rates, and is handed to
 * Google. Texting needs every business registered with the phone carriers
 * before its first message (docs/backend/TEXT_REQUESTS.md), and is turned on
 * only once there is data that it earns more than it costs.
 *
 * While it is off, nothing anywhere offers, sells or sends a text:
 * - the website and the iPhone app show Home, Feedback and Tags only;
 * - /text-requests and /settings/connections redirect, and their APIs answer
 *   404 (`proxy.ts`), and sending refuses even if a request reaches it;
 * - plans, pricing and Billing do not mention texts, and packs cannot be
 *   bought;
 * - readiness does not require Twilio or the pack prices.
 * STOP/HELP handling and the SMS webhooks keep working regardless: an opt-out
 * must always be honoured.
 *
 * One variable, read on the server and inlined into the browser bundle at
 * build time, so a change needs a redeploy (as every Vercel variable does):
 *
 *   NEXT_PUBLIC_TEXTING_ENABLED=true   texting on
 *   anything else, or unset            texting off
 *
 * The iPhone app reads the same answer from `/api/v1/home` (`features`), and
 * also needs a build made for texting (`EXPO_PUBLIC_TEXTING_ENABLED=true`,
 * apps/mobile/data/features.ts): App Review must see the Texts tab before
 * owners do (Guideline 2.3.1). So switching texting OFF is instant everywhere;
 * switching it ON in the app ships with a reviewed release.
 */
export function textingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TEXTING_ENABLED === "true";
}

/** What an owner sees when something texting-only is asked for while it is off. */
export const TEXTING_OFF_MESSAGE = "Texting isn't available yet.";

/** Pages that exist only for texting, and where each sends an owner instead. */
export const TEXTING_PAGES: ReadonlyArray<{ prefix: string; redirectTo: string }> = [
  { prefix: "/text-requests", redirectTo: "/home" },
  { prefix: "/settings/connections", redirectTo: "/settings" },
];

/** APIs that exist only for texting. SMS webhooks are deliberately not here. */
export const TEXTING_API_PREFIXES: readonly string[] = [
  "/api/v1/text-requests",
  "/api/v1/customers/lists",
  "/api/v1/connections",
];

export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
