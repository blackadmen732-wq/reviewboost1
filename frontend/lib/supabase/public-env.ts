/**
 * Publishable Supabase env used by the proxy and server client.
 *
 * Empty strings must never reach `createServerClient` — that throws
 * "Your project's URL and Key are required" and 500s the request, including
 * the public homepage whose own try/catch never runs because the proxy failed
 * first.
 *
 * Missing env is a deploy misconfiguration. Preview must wire a dedicated
 * Supabase project. Code must not "fix" that by skipping the owner auth gate.
 */

export class SupabaseEnvError extends Error {
  constructor() {
    super(
      "Supabase environment variables are not configured. Preview and production must set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseEnvError";
  }
}

export function readSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function requireSupabasePublicEnv(): { url: string; anonKey: string } {
  const env = readSupabasePublicEnv();
  if (!env) throw new SupabaseEnvError();
  return env;
}
