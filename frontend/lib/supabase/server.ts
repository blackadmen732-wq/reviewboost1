import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabasePublicEnv } from "@/lib/supabase/public-env";

/**
 * Supabase for Server Components and Route Handlers.
 *
 * Reads the session from cookies so a page can render already knowing who the
 * viewer is — no loading spinner on first paint, which matters more than it
 * sounds for someone on a phone in a busy kitchen.
 *
 * Still the publishable key, still subject to RLS. This is the caller's
 * session, not an elevated one.
 *
 * Fail-closed: missing URL/key throws rather than constructing a client with
 * empty strings. Callers that can render without a session (the public
 * homepage) already catch.
 */
export async function supabaseServer() {
  const { url, anonKey } = requireSupabasePublicEnv();
  const store = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Refresh is handled by the
          // middleware, so failing quietly here is correct rather than
          // crashing a render.
        }
      },
    },
  });
}

/** The signed-in user, or null. Never throws — callers decide what to do. */
export async function currentUser() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}
