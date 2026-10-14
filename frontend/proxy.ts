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
 *
 * WHY THE PATH IS CLASSIFIED BEFORE ANY AUTH WORK HAPPENS
 * -------------------------------------------------------
 * This used to build the Supabase client at the top, for every matched request.
 * `createServerClient` throws outright when the URL or key is missing, so an
 * environment without them turned *every* page into a 500 — including the
 * public homepage, which needs no session at all. A preview deployment missing
 * its Supabase values served `500` at `/` while the build and every status
 * check stayed green.
 *
 * A marketing page must not be hostage to the auth service being reachable or
 * configured. So the path decides first: public paths return untouched without
 * constructing a client, and only owner paths pay for an auth round-trip.
 */

/**
 * The owner application, by URL.
 *
 * Note `/stands`: the product calls the physical thing a Tag, but the route
 * kept its original name. `nav-items.ts` is the other half of this pairing.
 *
 * `/praise`, `/reviews` and `/customers` are historical views that are no
 * longer in the nav but are still real pages behind auth, so they stay listed.
 * `/login` is deliberately absent — it is where this file sends people, and
 * protecting it would be a redirect loop.
 */
const OWNER_PREFIXES = [
  "/home",
  "/feedback",
  "/text-requests",
  "/stands",
  "/customer-page",
  "/settings",
  "/onboarding",
  "/select-org",
  "/praise",
  "/reviews",
  "/customers",
];

/** Exported for tests: the route table drifting from the real app is the bug. */
export function isOwnerPath(pathname: string): boolean {
  return OWNER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes: no session needed, so no client is built and nothing here
  // can fail. This is what keeps a missing environment variable from taking
  // down the front door.
  if (!isOwnerPath(pathname)) {
    return NextResponse.next({ request });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request });
  let user = null;

  // Fail *closed*: if the session cannot be verified — misconfiguration, the
  // auth service being unreachable, a malformed cookie — the answer is "not
  // signed in", never "let them through" and never a crash.
  if (supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
      });

      // Must be `getUser`, not `getSession`. getSession reads the cookie and
      // trusts it; getUser verifies with the auth server. Protecting a route on
      // an unverified claim is protecting nothing.
      const result = await supabase.auth.getUser();
      user = result.data.user;
    } catch {
      user = null;
    }
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Carries where they were going, so signing in lands them there instead of
    // dumping them on a home page to navigate again.
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
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
