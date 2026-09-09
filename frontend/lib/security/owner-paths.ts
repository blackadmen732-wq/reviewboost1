/**
 * Owner surfaces the proxy must never render without a verified session.
 *
 * Convenience, not the security boundary — every owner API still requires a
 * bearer token, and RLS still decides what that session can read. A missing
 * prefix here would only render an empty page; a skipped check would do the
 * same. The load-bearing rule is: if the session cannot be verified, treat
 * the caller as signed out and send them to login.
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

export function isOwnerPath(pathname: string): boolean {
  return OWNER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
