"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser Supabase client.
 *
 * Carries only the publishable key, which grants nothing on its own: every
 * table denies `anon`, and what a signed-in session may see is decided by Row
 * Level Security in the database. The service-role key never comes near this
 * file — it lives in `lib/server`, behind a `server-only` import that turns an
 * accidental client import into a build error.
 */

let client: ReturnType<typeof createBrowserClient> | undefined;

export function supabaseBrowser() {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
  return client;
}
