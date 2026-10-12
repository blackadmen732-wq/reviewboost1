import { NextResponse, type NextRequest } from "next/server";

import type { OAuthErrorCode } from "@/lib/auth/oauth-providers";
import { logger } from "@/lib/server/logger";
import { publicFrontendUrl } from "@/lib/server/env";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where Apple and Google send the owner back after "Continue with …".
 *
 * Supabase Auth runs the provider exchange and returns here with a one-time
 * `code` (PKCE). Exchanging it sets the same session cookies the email code
 * sets, so everything after this point — requireOwner, organization
 * membership, role checks, RLS — is unchanged.
 *
 * `next` comes back through the provider, so it is validated again here and
 * never followed off-site. Every failure lands on /login with a short reason
 * and the original destination, never on a blank error page.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backToLogin(origin: string, next: string, reason: OAuthErrorCode) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", reason);
  if (next !== "/home") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const origin = publicFrontendUrl();
  const params = request.nextUrl.searchParams;
  const next = safeInternalPath(params.get("next"), origin);

  // The provider or Supabase reports a refusal as ?error=… instead of a code.
  // "access_denied" is what both send when the person closes or cancels the
  // Apple or Google sheet; that is not a failure worth alarming anyone about.
  const providerError = params.get("error");
  if (providerError) {
    return backToLogin(origin, next, providerError === "access_denied" ? "cancelled" : "failed");
  }

  const code = params.get("code");
  if (!code) return backToLogin(origin, next, "failed");

  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // A code is single-use and short-lived: a refresh of this URL, or a
      // return after the verifier cookie expired, ends here.
      const expired = /expired|invalid|verifier/i.test(error.message);
      logger.warn("auth.oauth_exchange_failed", { reason: expired ? "expired" : "error" });
      return backToLogin(origin, next, expired ? "expired" : "failed");
    }
  } catch {
    logger.warn("auth.oauth_exchange_failed", { reason: "exception" });
    return backToLogin(origin, next, "failed");
  }

  return NextResponse.redirect(new URL(next, origin));
}
