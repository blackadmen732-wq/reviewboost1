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
    throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
  }

  return { role: data.role as string };
}

export function requireRole(role: string, allowed: readonly string[]): void {
  if (!allowed.includes(role)) {
    throw new ApiError(403, ERROR_CODE.forbidden, "You do not have permission to do that.");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_COOKIE = "rb-active-org";

function parseCookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = header.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export interface OrganizationContext extends AuthenticatedContext {
  orgId: string;
  role: string;
}

/**
 * Resolve the caller's active organization, or null if they have none yet.
 *
 * Priority: X-Organization-Id header (API/mobile) > rb-active-org cookie
 * (browser). Query-string org_id is accepted as a fallback but is not the
 * normal browser mechanism.
 *
 * The selected value is validated against the user's actual memberships
 * every time. It is selection only, never authorization — RLS is the
 * security boundary.
 *
 * Belonging to no organization is an answer here rather than an error, which
 * is what onboarding needs: a user with nothing yet is the entire point of
 * that screen, and a 404 would make the first run an error page.
 *
 * What it never does is pick the first membership. A user in two businesses
 * who has selected one must be answered about that one -- being told about the
 * business they joined first, silently, is how an owner ends up reading one
 * business's numbers while believing they are the other's.
 */
export async function selectOrganization(
  context: AuthenticatedContext,
  request: Request,
): Promise<{ orgId: string; role: string } | null> {
  const headerOrgId = request.headers.get("x-organization-id");
  const cookieOrgId = parseCookieValue(request, ORG_COOKIE);
  const url = new URL(request.url);
  const queryOrgId = url.searchParams.get("org_id");

  const explicitOrgId = headerOrgId ?? cookieOrgId ?? queryOrgId;

  const { data: memberships, error } = await context.db
    .from("organization_members")
    .select("org_id, role")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(404, ERROR_CODE.notFound, "You do not have a business set up yet.");
  }

  if (!memberships || memberships.length === 0) return null;

  if (explicitOrgId) {
    if (!UUID_RE.test(explicitOrgId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "Invalid organization identifier.");
    }
    const match = memberships.find((m) => m.org_id === explicitOrgId);
    if (!match) {
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }
    return { orgId: match.org_id as string, role: match.role as string };
  }

  if (memberships.length === 1) {
    const m = memberships[0]!;
    return { orgId: m.org_id as string, role: m.role as string };
  }

  // Two or more memberships and no selection. The one thing that must not
  // happen here is a guess. The ordering above exists to make the query
  // deterministic, never to pick a winner.
  throw new ApiError(
    400,
    ERROR_CODE.organizationSelectionRequired,
    "You belong to multiple organizations. Select which one to use.",
  );
}

export async function resolveOrganizationContext(
  request: Request,
): Promise<OrganizationContext | null> {
  const context = await requireUser(request);
  const selected = await selectOrganization(context, request);
  return selected ? { ...context, ...selected } : null;
}

/**
 * The same, for every endpoint that has no meaning without a business.
 */
export async function requireOrganizationContext(
  request: Request,
): Promise<OrganizationContext> {
  const context = await requireUser(request);
  const selected = await selectOrganization(context, request);
  if (!selected) {
    throw new ApiError(404, ERROR_CODE.notFound, "You do not have a business set up yet.");
  }
  return { ...context, ...selected };
}
