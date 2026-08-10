import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAnonKey, supabaseUrl } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";

/**
 * Authenticated request context for the owner API.
 *
 * THE DECISION THAT MATTERS
 * -------------------------
 * Owner endpoints do **not** use the service-role client. They build a client
 * carrying the caller's own access token, so every query runs as
 * `authenticated` with `auth.uid()` set — which means Row Level Security is
 * doing the isolation, on every statement, for free.
 *
 * The alternative — service role plus a `WHERE org_id = ...` the handler
 * remembers to add — puts tenant isolation in the hands of whoever writes the
 * next query. One forgotten clause and one business reads another's feedback.
 * RLS cannot be forgotten.
 *
 * The service role stays confined to the anonymous customer flow, where there
 * is no user for RLS to key on.
 */

export interface AuthenticatedContext {
  userId: string;
  /** Scoped to the caller. Every query is subject to RLS as that user. */
  db: SupabaseClient;
}

function unauthorized(): ApiError {
  // Deliberately says nothing about why. A caller who cannot authenticate
  // learns nothing about whether the token was expired, malformed, or revoked.
  return new ApiError(401, ERROR_CODE.validationFailed, "Authentication is required.");
}

/**
 * Resolve the caller, or reject.
 *
 * The bearer token is a Supabase session token issued by Supabase Auth. It is
 * verified by asking Supabase, not by decoding it here: a locally-decoded JWT
 * proves only that somebody could produce a well-formed string unless the
 * signature is checked against current keys, and getting that wrong is a
 * complete authentication bypass.
 */
export async function requireUser(request: Request): Promise<AuthenticatedContext> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) throw unauthorized();
  // Bounded before it reaches the network: an unbounded header is a cheap way
  // to make every request do expensive work.
  if (token.length > 4096) throw unauthorized();

  const db = createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw unauthorized();

  return { userId: data.user.id, db };
}

/**
 * Resolve the caller's membership of one organization.
 *
 * Returns the role so a handler can check it, but the role is **not** the
 * security boundary — RLS is. This exists so a handler can return a clean 403
 * instead of an empty result set when someone lacks permission, which is a
 * usability property, not a protective one.
 */
export async function requireMembership(
  context: AuthenticatedContext,
  organizationId: string,
): Promise<{ role: string }> {
  const { data, error } = await context.db
    .from("organization_members")
    .select("role")
    .eq("org_id", organizationId)
    .eq("user_id", context.userId)
    .eq("status", "active")
    .maybeSingle();

  // The row is invisible under RLS if the caller is not an active member, so a
  // non-member and a non-existent organization look identical here — which is
  // what we want.
  if (error || !data) {
    throw new ApiError(404, ERROR_CODE.reviewLinkInactive, "Not found.");
  }

  return { role: data.role as string };
}

export function requireRole(role: string, allowed: readonly string[]): void {
  if (!allowed.includes(role)) {
    throw new ApiError(403, ERROR_CODE.validationFailed, "You do not have permission to do that.");
  }
}
