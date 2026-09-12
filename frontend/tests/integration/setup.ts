/**
 * Integration test setup.
 *
 * Verifies that a local Supabase instance is running before tests execute.
 * Tests in this suite hit real database RPCs through the Supabase client,
 * not mocks.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required for integration tests.\n" +
      "Run: supabase start && eval $(supabase status -o env)",
  );
}

export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function createTestUser(email: string, password = "test-password-123!") {
  const admin = serviceClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create test user: ${error.message}`);
  return data.user;
}

export async function signIn(email: string, password = "test-password-123!") {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to sign in: ${error.message}`);
  return {
    accessToken: data.session.access_token,
    userId: data.user.id,
    client: createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
  };
}

export async function cleanupTestUser(userId: string) {
  const admin = serviceClient();
  await admin.auth.admin.deleteUser(userId);
}
