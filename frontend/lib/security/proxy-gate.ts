import { isOwnerPath } from "@/lib/security/owner-paths";
import { readSupabasePublicEnv } from "@/lib/supabase/public-env";

/**
 * Fail-closed session for the proxy.
 *
 * Missing publishable Supabase env is "no verified user", never "skip the
 * owner check". The proxy still has to call `getUser()` when env is present;
 * this helper is the decision that must not be skipped.
 */
export function unverifiedWhenEnvMissing(): true | false {
  return !readSupabasePublicEnv().ok;
}

export function mustRedirectOwnerToLogin(
  pathname: string,
  user: { id: string } | null,
): boolean {
  return isOwnerPath(pathname) && !user;
}

export function loginRedirectFor(pathname: string): { pathname: "/login"; next: string } {
  return { pathname: "/login", next: pathname };
}
