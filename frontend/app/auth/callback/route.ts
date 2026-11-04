import { type NextRequest, NextResponse } from "next/server";

import { appleServicesId, keepAppleRefreshToken } from "@/lib/server/apple-sign-in";
import { logger } from "@/lib/server/logger";
import { requestIdOf } from "@/lib/server/http";
import { publicFrontendUrl } from "@/lib/server/env";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where Google and Apple send someone back after "Continue with …", and
 * where the sign-in email's "tap here" link returns (`provider=email`).
 *
 * Supabase returns a one-time `code`; exchanging it here sets the session
 * cookies (PKCE: the browser kept the verifier). Then the person lands where
 * they were going, which is checked to be an internal path. Anything that
 * goes wrong lands on the sign-in page with one fixed sentence; the provider's
 * own error text is never shown or logged with personal details.
 *
 * For Apple, the refresh token Supabase received is kept (encrypted) so the
 * account can be revoked with Apple if it is ever deleted (Guideline 5.1.1(v),
 * lib/server/apple-sign-in.ts). That step never blocks the sign-in.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  const url = request.nextUrl;
  // Redirects go to the app's own origin, not `request.url`: Next builds that
  // from its bind address (`localhost`) under `next dev` and `next start`, and
  // a session cookie set for the host the browser used is not sent to
  // localhost, so the person landed on sign-in again with a valid session.
  const origin = publicFrontendUrl();
  const next = safeInternalPath(url.searchParams.get("next"), origin);
  const provider = url.searchParams.get("provider");
  const code = url.searchParams.get("code");

  const failed = () => {
    const back = new URL("/login", origin);
    back.searchParams.set("next", next);
    back.searchParams.set("error", "sign_in_failed");
    return NextResponse.redirect(back);
  };

  if (!code) {
    // The person cancelled at Google or Apple, or the provider refused.
    logger.info("auth.oauth_returned_without_code", { requestId, provider });
    return failed();
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    logger.warn("auth.oauth_exchange_failed", { requestId, provider, status: error?.status ?? null });
    return failed();
  }

  const servicesId = appleServicesId();
  const appleRefresh = data.session.provider_refresh_token;
  if (provider === "apple" && servicesId && appleRefresh) {
    await keepAppleRefreshToken(data.session.user.id, appleRefresh, servicesId, requestId);
  }

  return NextResponse.redirect(new URL(next, origin));
}
