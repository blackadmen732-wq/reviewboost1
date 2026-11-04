import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import {
  matchesPrefix,
  TEXTING_API_PREFIXES,
  TEXTING_OFF_MESSAGE,
  TEXTING_PAGES,
  textingEnabled,
} from "@/lib/features";

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

/**
 * Texting is switched off (`lib/features.ts`): its pages send an owner
 * somewhere useful and its APIs answer 404, before any auth work, so nothing
 * texting-only can be reached by a link, a bookmark or an old app build. The
 * services that send also refuse on their own; this is the front door.
 */
export function textingGate(request: NextRequest): NextResponse | null {
  if (textingEnabled()) return null;
  const { pathname } = request.nextUrl;

  if (TEXTING_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return NextResponse.json(
      { error: { code: "not_found", message: TEXTING_OFF_MESSAGE } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const page = TEXTING_PAGES.find(({ prefix }) => matchesPrefix(pathname, prefix));
  if (page) {
    const url = request.nextUrl.clone();
    url.pathname = page.redirectTo;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return null;
}

/**
 * The auth service did not answer (a network failure or its own 5xx), which
 * is not the same as being signed out. Still fail closed: nothing of the
 * owner's is shown. But say what is true and recover by itself, rather than
 * send an owner to sign in during an outage (they would think they had been
 * signed out, and signing in would fail too).
 *
 * A page load gets `/unavailable`, at the same address, which tries again by
 * itself. A client navigation or refresh gets a 503, which makes Next load
 * the page in full, and so reach that page.
 */
export function unansweredResponse(request: NextRequest): NextResponse {
  const headers = { "cache-control": "no-store", "retry-after": "3" };
  if (request.headers.get("rsc") === "1" || request.headers.has("next-router-prefetch")) {
    return new NextResponse(null, { status: 503, headers });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/unavailable";
  url.search = "";
  return NextResponse.rewrite(url, { headers });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const blocked = textingGate(request);
  if (blocked) return blocked;

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
  /** The auth service did not answer: not the same as signed out. */
  let unanswered = false;

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
      unanswered = !user && isAuthRetryableFetchError(result.error);
    } catch {
      user = null;
    }
  }

  if (!user && unanswered) return unansweredResponse(request);

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
