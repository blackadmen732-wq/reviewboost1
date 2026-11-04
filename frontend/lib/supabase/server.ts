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

/**
 * The signed-in user, or null. Never throws — callers decide what to do.
 *
 * "Never throws" has to be enforced, not just promised. `createServerClient`
 * throws outright when the Supabase URL or key is missing, so on an environment
 * without them this used to crash every caller — including `/login`, which is
 * where an unauthenticated visitor is sent, making the way back in a 500.
 *
 * Any failure to establish who the viewer is means "nobody", which is the
 * fail-closed answer: callers treat null as signed out.
 */
export async function currentUser() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}
