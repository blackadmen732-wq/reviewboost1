import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase for Server Components and Route Handlers.
 *
 * Reads the session from cookies so a page can render already knowing who the
 * viewer is — no loading spinner on first paint, which matters more than it
 * sounds for someone on a phone in a busy kitchen.
 *
 * Still the publishable key, still subject to RLS. This is the caller's
 * session, not an elevated one.
 */
export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
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
    },
  );
}

/** The signed-in user, or null. Never throws — callers decide what to do. */
export async function currentUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user;
}
