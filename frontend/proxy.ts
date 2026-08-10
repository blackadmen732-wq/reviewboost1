import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
* Session refresh and route protection.
 *
 * Two jobs, and the first is the one that is easy to miss: a Supabase access
 * token expires in an hour, and only a request that touches `getUser()` will
 * refresh it. Without this, an owner who leaves the tab open over a shift comes
 * back to a dead session and a login screen for no reason they can see.
 *
 * The second is redirecting signed-out visitors away from owner pages. That is
 * a *convenience*, not the security boundary — every owner API route
 * independently requires a bearer token, and Row Level Security independently
 * decides what any session can read. Middleware that was bypassed would leak
 * nothing; it would just render an empty page.
 */

const OWNER_PREFIXES = ["/home", "/feedback", "/praise", "/stands", "/settings", "/onboarding"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be `getUser`, not `getSession`. getSession reads the cookie and trusts
  // it; getUser verifies with the auth server. Protecting a route on an
  // unverified claim is protecting nothing.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isOwnerPage = OWNER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isOwnerPage && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Carries where they were going, so signing in lands them there instead of
    // dumping them on a home page to navigate again.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the public customer flow.
     *
     * `/q/:token` is excluded deliberately: it is anonymous, it is the hot path,
     * and running an auth round-trip on it would add latency to the one screen
     * that has to feel instant on a phone with two bars of signal.
     */
    "/((?!_next/static|_next/image|favicon.ico|q/|api/v1/public|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
