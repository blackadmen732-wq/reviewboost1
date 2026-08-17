import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/server/env";

/**
 * The service-role Supabase client.
 *
 * **This key bypasses Row Level Security entirely.** It is the most dangerous
 * credential in the system, and three things keep it contained:
 *
 *   1. `server-only` above — importing this from a client component is a build
 *      error, not a runtime leak.
 *   2. The key is read through `env.ts`, which refuses to start if anyone has
 *      exposed it under a `NEXT_PUBLIC_*` name.
 *   3. It is used exclusively to call the narrow `app.*` functions, never to
 *      query tables directly. Those functions derive the tenant from the stand
 *      token and can each touch exactly one business, so a bug in a handler
 *      cannot turn into "read every organization's responses".
 *
 * If a future caller here starts issuing `.from("customer_responses")` queries,
 * that third protection is gone and RLS is no longer defending anything on this
 * path. Add the operation as a definer function instead.
 */

let client: SupabaseClient | undefined;

export function serviceRoleClient(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl(), supabaseServiceRoleKey(), {
      auth: {
        // No session to persist or refresh: this client acts as the service, not
        // as a user, and a persisted session would be a cross-request leak.
        persistSession: false,
        autoRefreshToken: false,
      },
      db: { schema: "public" },
      global: { headers: { "X-Client-Info": "reviewboost-public-api" } },
    });
  }

  return client;
}

/** Reset between tests. Not used in production code. */
export function __resetSupabaseClientForTests(): void {
  client = undefined;
}
