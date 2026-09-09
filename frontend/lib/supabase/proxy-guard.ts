/**
 * Owner-route gate used by `proxy.ts`.
 *
 * Extracted so the fail-closed rules can be unit-tested without standing up
 * Next or Supabase. The proxy is a convenience redirect for pages; every owner
 * API still authenticates independently and RLS still decides what a session
 * can read.
 */

export const OWNER_PREFIXES = [
  "/home",
  "/feedback",
  "/praise",
  "/stands",
  "/settings",
  "/onboarding",
  "/reviews",
  "/customers",
  "/select-org",
] as const;

export type OwnerPrefix = (typeof OWNER_PREFIXES)[number];

export type ProxyAccessDecision =
  | { action: "allow" }
  | { action: "redirect-login"; next: string }
  | { action: "unavailable" };

export function isOwnerPath(pathname: string): boolean {
  return OWNER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Decide whether a matched request may proceed.
 *
 * Missing Supabase env must fail closed for owner pages — never `next()` them
 * unsigned. Public pages may still render; their own loaders already catch a
 * missing client.
 */
export function decideProxyAccess(input: {
  pathname: string;
  hasSupabaseEnv: boolean;
  user: { id: string } | null;
}): ProxyAccessDecision {
  const owner = isOwnerPath(input.pathname);

  if (!input.hasSupabaseEnv) {
    return owner ? { action: "unavailable" } : { action: "allow" };
  }

  if (owner && !input.user) {
    return { action: "redirect-login", next: input.pathname };
  }

  return { action: "allow" };
}
