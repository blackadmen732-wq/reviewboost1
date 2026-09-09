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

const OWNER_PREFIXES = ["/home", "/feedback", "/praise", "/stands", "/settings", "/onboarding", "/reviews", "/customers", "/select-org"];

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return response;
  }

  let finalResponse = response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        finalResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          finalResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isOwnerPage = OWNER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isOwnerPage && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return finalResponse;
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
