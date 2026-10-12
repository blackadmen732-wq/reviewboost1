/**
 * Which "Continue with …" buttons the sign-in screen shows.
 *
 * A provider button appears only when its switch is on. The switch is turned on
 * once that provider is configured in Supabase Auth (Apple: Services ID, key and
 * return URL; Google: OAuth client and return URL). Until then the button is not
 * rendered at all, so nobody taps a button that can only fail.
 *
 * Email sign-in does not depend on these and always works.
 */

export type OAuthProvider = "apple" | "google";

export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["apple", "google"];

function flag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/**
 * Read at build time (NEXT_PUBLIC_*), so the server render and the browser
 * agree on which buttons exist.
 */
export function enabledOAuthProviders(
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_AUTH_APPLE_ENABLED: process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED,
    NEXT_PUBLIC_AUTH_GOOGLE_ENABLED: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED,
  },
): OAuthProvider[] {
  const enabled: OAuthProvider[] = [];
  // Apple first: when an app offers a third-party sign-in, Apple asks for Sign
  // in with Apple to be offered with equal prominence.
  if (flag(env.NEXT_PUBLIC_AUTH_APPLE_ENABLED)) enabled.push("apple");
  if (flag(env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED)) enabled.push("google");
  return enabled;
}

/**
 * Where the provider sends the browser back to. `next` is carried through and
 * re-validated by the callback route, never trusted from here.
 */
export function oauthRedirectTo(origin: string, next: string): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", next);
  return url.toString();
}

/** Errors the callback route passes back to /login, and what the owner reads. */
export const OAUTH_ERROR_MESSAGES = {
  cancelled: "Sign-in was cancelled. Choose a way to continue.",
  failed: "That sign-in didn’t go through. Try again, or continue with email.",
  expired: "That sign-in link expired. Start again.",
} as const;

export type OAuthErrorCode = keyof typeof OAUTH_ERROR_MESSAGES;

export function oauthErrorCode(value: string | null | undefined): OAuthErrorCode | null {
  return value === "cancelled" || value === "failed" || value === "expired" ? value : null;
}
