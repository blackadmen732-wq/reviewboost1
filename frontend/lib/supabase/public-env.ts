/**
 * Publishable Supabase env — URL and anon key.
 *
 * Safe to import from the proxy (Edge) and from Server Components. These
 * values grant nothing on their own: every table denies `anon`, and RLS
 * decides what a signed-in session may see. They must still be present
 * before a client is constructed. Passing empty strings to
 * `createServerClient` throws and 500s the request, including public pages
 * whose own try/catch never runs.
 *
 * Missing values are not a reason to skip authentication. Callers treat
 * "not configured" as "no verified user" and still deny owner surfaces.
 */

export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

export function readSupabasePublicEnv():
  | { ok: true; env: SupabasePublicEnv }
  | { ok: false } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return { ok: false };
  return { ok: true, env: { url, anonKey } };
}

export function requireSupabasePublicEnv(): SupabasePublicEnv {
  const read = readSupabasePublicEnv();
  if (!read.ok) {
    throw new Error("Supabase environment variables are not configured");
  }
  return read.env;
}
