import "server-only";

import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { OrganizationContext } from "@/lib/server/auth";
import { keyedDigest } from "@/lib/server/crypto";
import { publicFrontendUrl, tokenDigestKey } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { getAdapter } from "@/lib/server/integrations/adapters";
import { sealTokens } from "@/lib/server/integrations/credentials";
import { normalizeProviderPhone } from "@/lib/server/integrations/normalize";
import { ConnectionUnavailableError, loadConnection, reportOutcome } from "@/lib/server/integrations/pipeline";
import {
  getConnectableProvider,
  getProvider,
  getWorkflow,
  listProviders,
  type ProviderDefinition,
} from "@/lib/server/integrations/registry";
import { mapIntegrationRpcError } from "@/lib/server/integrations/rpc";
import { ProviderError, type CanonicalVisitInput, type ProviderLocation } from "@/lib/server/integrations/types";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Connections, as the owner drives them (docs/connections/05 and 06).
 *
 * Every step is a separate, explicit action: connect (sign in at the
 * provider), choose places, run the check, turn on, update now, disconnect.
 * None of them sends a message. Reads go through the caller's own client, so
 * RLS decides what they see; writes go through the database's definer
 * functions with the organization taken from the verified session, never from
 * the request body.
 */

const OAUTH_STATE_TTL_SECONDS = 600;
const BACKFILL_DAYS = 30;
const TEST_DAYS = 7;
const TEST_SAMPLE = 25;
const MANUAL_BUCKET_SECONDS = 300;

export const CONNECTION_COLUMNS =
  "id, provider_id, workflow_id, external_account_label, state, health, warning_codes, config_version, last_test_config_version, last_test_passed, last_test_at, last_test_summary, last_success_at, last_attempt_at, last_error_code, created_at, disconnected_at";

export interface ConnectionSummary {
  id: string;
  providerId: string;
  workflowId: string;
  accountLabel: string | null;
  state: string;
  health: string;
  warningCodes: string[];
  configVersion: number;
  testedConfigVersion: number | null;
  lastTestPassed: boolean | null;
  lastTestAt: string | null;
  lastTestSummary: TestSummary | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
}

export interface TestSummary {
  visitsFound: number;
  withCustomer: number;
  reachable: number;
  noPhone: number;
  otherPlaces: number;
}

interface ConnectionDbRow {
  id: string;
  provider_id: string;
  workflow_id: string;
  external_account_label: string | null;
  state: string;
  health: string;
  warning_codes: string[] | null;
  config_version: number;
  last_test_config_version: number | null;
  last_test_passed: boolean | null;
  last_test_at: string | null;
  last_test_summary: TestSummary | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error_code: string | null;
  created_at: string;
}

function toSummary(row: ConnectionDbRow): ConnectionSummary {
  return {
    id: row.id,
    providerId: row.provider_id,
    workflowId: row.workflow_id,
    accountLabel: row.external_account_label,
    state: row.state,
    health: row.health,
    warningCodes: row.warning_codes ?? [],
    configVersion: row.config_version,
    testedConfigVersion: row.last_test_config_version,
    lastTestPassed: row.last_test_passed,
    lastTestAt: row.last_test_at,
    lastTestSummary: row.last_test_summary,
    lastSuccessAt: row.last_success_at,
    lastAttemptAt: row.last_attempt_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
  };
}

function readFailure(context: string, error: unknown, requestId: string): never {
  logger.error("integrations.read_failed", { context, requestId, error });
  throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}

function firstRow<T>(data: unknown): T | undefined {
  return (Array.isArray(data) ? data[0] : data) as T | undefined;
}

// ------------------------------------------------------------------ reads ---

/** The directory: every provider this environment knows, without anything secret. */
export function providerDirectory(): Array<
  Pick<ProviderDefinition, "id" | "displayName" | "monogram" | "categories" | "summary" | "availability"> & {
    workflows: Array<{ id: string; label: string }>;
  }
> {
  return listProviders().map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    monogram: provider.monogram,
    categories: provider.categories,
    summary: provider.summary,
    availability: provider.availability,
    workflows: provider.workflows.map((workflow) => ({ id: workflow.id, label: workflow.label })),
  }));
}

/** Live connections (not disconnected), through the caller's RLS. */
export async function listConnections(db: SupabaseClient, orgId: string, requestId: string): Promise<ConnectionSummary[]> {
  const { data, error } = await db
    .from("integration_connections")
    .select(CONNECTION_COLUMNS)
    .eq("org_id", orgId)
    .neq("state", "disconnected")
    .order("created_at", { ascending: true });
  if (error) readFailure("list_connections", error, requestId);
  return ((data ?? []) as ConnectionDbRow[]).map(toSummary);
}

export async function getConnection(
  db: SupabaseClient,
  orgId: string,
  connectionId: string,
  requestId: string,
): Promise<ConnectionSummary> {
  const { data, error } = await db
    .from("integration_connections")
    .select(CONNECTION_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) readFailure("get_connection", error, requestId);
  if (!data) throw new ApiError(404, ERROR_CODE.notFound, "That connection was not found.");
  return toSummary(data as ConnectionDbRow);
}

export interface PlaceMapping {
  externalLocationId: string;
  externalLocationName: string | null;
  locationId: string;
}

export async function listMappings(db: SupabaseClient, connectionId: string, requestId: string): Promise<PlaceMapping[]> {
  const { data, error } = await db
    .from("integration_location_mappings")
    .select("external_location_id, external_location_name, location_id")
    .eq("connection_id", connectionId)
    .order("external_location_name", { ascending: true });
  if (error) readFailure("list_mappings", error, requestId);
  return ((data ?? []) as Array<{ external_location_id: string; external_location_name: string | null; location_id: string }>).map(
    (row) => ({
      externalLocationId: row.external_location_id,
      externalLocationName: row.external_location_name,
      locationId: row.location_id,
    }),
  );
}

export interface RunSummary {
  id: string;
  kind: string;
  status: string;
  counts: Record<string, number>;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export async function listRuns(db: SupabaseClient, connectionId: string, requestId: string, limit = 10): Promise<RunSummary[]> {
  const { data, error } = await db
    .from("integration_sync_runs")
    .select("id, kind, status, counts, error_code, created_at, finished_at")
    .eq("connection_id", connectionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) readFailure("list_runs", error, requestId);
  return (
    (data ?? []) as Array<{
      id: string;
      kind: string;
      status: string;
      counts: Record<string, number> | null;
      error_code: string | null;
      created_at: string;
      finished_at: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    counts: row.counts ?? {},
    errorCode: row.error_code,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }));
}

export interface IssueSummary {
  id: string;
  objectType: string;
  issueCode: string;
  hint: string | null;
  lastSeenAt: string;
}

export async function listOpenIssues(
  db: SupabaseClient,
  connectionId: string,
  requestId: string,
  limit = 50,
): Promise<IssueSummary[]> {
  const { data, error } = await db
    .from("integration_record_issues")
    .select("id, object_type, issue_code, display_hint, last_seen_at")
    .eq("connection_id", connectionId)
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) readFailure("list_issues", error, requestId);
  return (
    (data ?? []) as Array<{ id: string; object_type: string; issue_code: string; display_hint: string | null; last_seen_at: string }>
  ).map((row) => ({
    id: row.id,
    objectType: row.object_type,
    issueCode: row.issue_code,
    hint: row.display_hint,
    lastSeenAt: row.last_seen_at,
  }));
}

// -------------------------------------------------------- authorization ---

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const authorizeSchema = z.strictObject({
  workflowId: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Choose what to connect."),
  reconnectConnectionId: z.string().regex(UUID_RE, "Invalid connection.").optional(),
});

export const callbackSchema = z.strictObject({
  state: z.string().min(16).max(200),
  code: z.string().min(1).max(2000).optional(),
  error: z.string().max(200).optional(),
});

function connectableOrThrow(providerId: string): ProviderDefinition {
  const provider = getConnectableProvider(providerId);
  if (!provider || !getAdapter(provider.id)) {
    throw new ApiError(404, ERROR_CODE.providerUnavailable, "That app can't be connected yet.");
  }
  return provider;
}

function stateDigest(state: string): string {
  return keyedDigest(state, "integration_oauth_state", tokenDigestKey());
}

function redirectUriFor(providerId: string): string {
  return new URL(`/settings/connections/${providerId}/callback`, publicFrontendUrl()).toString();
}

/**
 * Begin a connection: a single-use, short-lived state bound to this user and
 * business, and the provider's sign-in address. The state's digest is stored,
 * never the state itself.
 */
export async function startAuthorization(
  context: OrganizationContext,
  providerId: string,
  input: z.infer<typeof authorizeSchema>,
  requestId: string,
): Promise<{ authorizeUrl: string }> {
  const provider = connectableOrThrow(providerId);
  const workflow = getWorkflow(provider, input.workflowId);
  if (!workflow) throw new ApiError(400, ERROR_CODE.validationFailed, "Choose what to connect.");
  const adapter = getAdapter(provider.id)!;

  const state = randomBytes(32).toString("base64url");
  const { error } = await serviceRoleClient().rpc("rpc_integration_oauth_state_create", {
    p_state_digest: stateDigest(state),
    p_org_id: context.orgId,
    p_user_id: context.userId,
    p_provider_id: provider.id,
    p_workflow_id: workflow.id,
    p_requested_scopes: [...workflow.scopes],
    p_code_verifier_enc: null,
    p_reconnect_connection_id: input.reconnectConnectionId ?? null,
    p_ttl_seconds: OAUTH_STATE_TTL_SECONDS,
  });
  if (error) throw mapIntegrationRpcError(error, requestId);

  const url = adapter.buildAuthorizeUrl({ state, scopes: workflow.scopes, redirectUri: redirectUriFor(provider.id) });
  return { authorizeUrl: url.toString() };
}

/**
 * Finish a connection. The state must be live, unused, issued to this user,
 * for this business and this provider. Tokens go straight from the provider
 * into encrypted storage; nothing about them is returned.
 */
export async function completeAuthorization(
  context: OrganizationContext,
  providerId: string,
  input: z.infer<typeof callbackSchema>,
  requestId: string,
): Promise<{ connectionId: string; state: string }> {
  const provider = connectableOrThrow(providerId);
  const adapter = getAdapter(provider.id)!;
  const svc = serviceRoleClient();

  const { data, error } = await svc.rpc("rpc_integration_oauth_state_consume", {
    p_state_digest: stateDigest(input.state),
    p_user_id: context.userId,
  });
  if (error) throw mapIntegrationRpcError(error, requestId);
  const pending = firstRow<{
    org_id: string;
    provider_id: string;
    workflow_id: string;
    requested_scopes: string[];
    reconnect_connection_id: string | null;
  }>(data);

  // Started in another business (the owner switched in between) or for
  // another app: refuse, rather than attach an account to the wrong place.
  if (!pending || pending.org_id !== context.orgId || pending.provider_id !== provider.id) {
    throw new ApiError(400, ERROR_CODE.oauthStateInvalid, "That took too long or was already used. Please start again.");
  }

  if (input.error || !input.code) {
    throw new ApiError(400, ERROR_CODE.oauthDenied, "Nothing was connected because access wasn't allowed.");
  }

  const workflow = getWorkflow(provider, pending.workflow_id);
  if (!workflow) throw new ApiError(404, ERROR_CODE.providerUnavailable, "That app can't be connected yet.");

  let tokens;
  let account;
  try {
    tokens = await adapter.exchangeCode({
      code: input.code,
      redirectUri: redirectUriFor(provider.id),
      requestedScopes: pending.requested_scopes,
    });
    account = await adapter.discoverAccount(tokens);
  } catch (caught) {
    const classification = caught instanceof ProviderError ? caught.classification : adapter.classifyError(caught);
    logger.warn("integrations.authorize_failed", { requestId, providerId: provider.id, reason: classification.reason });
    throw new ApiError(
      503,
      ERROR_CODE.providerUnavailable,
      `${provider.displayName} didn't answer. Nothing was connected; please try again.`,
    );
  }

  const grant = adapter.verifyGrant(tokens, pending.requested_scopes);
  const sealed = sealTokens(tokens, {
    orgId: context.orgId,
    providerId: provider.id,
    externalAccountId: account.externalAccountId,
  });
  const common = {
    p_org_id: context.orgId,
    p_external_account_id: account.externalAccountId,
    p_granted_scopes: [...tokens.grantedScopes],
    p_scopes_sufficient: grant.sufficient,
    p_actor: context.userId,
    p_key_version: sealed.keyVersion,
    p_access_token_enc: sealed.accessTokenEnc,
    p_refresh_token_enc: sealed.refreshTokenEnc,
    p_access_expires_at: sealed.accessExpiresAt,
    p_refresh_expires_at: sealed.refreshExpiresAt,
  };

  if (pending.reconnect_connection_id) {
    const { data: state, error: reauthError } = await svc.rpc("rpc_integration_connection_reauthorize", {
      p_connection_id: pending.reconnect_connection_id,
      ...common,
    });
    if (reauthError) throw mapIntegrationRpcError(reauthError, requestId);
    return { connectionId: pending.reconnect_connection_id, state: String(state) };
  }

  const { data: created, error: createError } = await svc.rpc("rpc_integration_connection_create", {
    ...common,
    p_provider_id: provider.id,
    p_workflow_id: workflow.id,
    p_external_account_label: account.label?.slice(0, 120) ?? null,
  });
  if (createError) throw mapIntegrationRpcError(createError, requestId);
  const row = firstRow<{ connection_id: string; state: string }>(created);
  if (!row) throw mapIntegrationRpcError(null, requestId);
  return { connectionId: row.connection_id, state: row.state };
}

// ------------------------------------------------------------ setup steps ---

/** Verify the connection is this business's before acting on it with the service role. */
async function ownedConnection(orgId: string, connectionId: string, requestId: string) {
  if (!UUID_RE.test(connectionId)) throw new ApiError(404, ERROR_CODE.notFound, "That connection was not found.");
  const { data, error } = await serviceRoleClient().rpc("rpc_integration_owned_connection", {
    p_org_id: orgId,
    p_connection_id: connectionId,
  });
  if (error) readFailure("owned_connection", error, requestId);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { id: string; org_id: string; provider_id: string; workflow_id: string; state: string; config_version: number }
    | null
    | undefined;
  if (!row) throw new ApiError(404, ERROR_CODE.notFound, "That connection was not found.");
  return row;
}

async function withProvider<T>(
  orgId: string,
  connectionId: string,
  requestId: string,
  run: (loaded: Awaited<ReturnType<typeof loadConnection>>) => Promise<T>,
): Promise<T> {
  const svc = serviceRoleClient();
  let loaded;
  try {
    loaded = await loadConnection(svc, connectionId);
  } catch (caught) {
    if (caught instanceof ConnectionUnavailableError) {
      throw new ApiError(409, ERROR_CODE.providerUnavailable, "This connection can't be reached right now.");
    }
    if (caught instanceof ProviderError && caught.classification.kind === "auth") {
      throw new ApiError(409, ERROR_CODE.connectionStateInvalid, "Sign in again to keep this connected.");
    }
    throw caught;
  }
  if (loaded.connection.org_id !== orgId) throw new ApiError(404, ERROR_CODE.notFound, "That connection was not found.");

  try {
    return await run(loaded);
  } catch (caught) {
    if (caught instanceof ApiError) throw caught;
    const classification = caught instanceof ProviderError ? caught.classification : loaded.adapter.classifyError(caught);
    await reportOutcome(svc, loaded.connection, classification);
    logger.warn("integrations.provider_call_failed", { requestId, connectionId, reason: classification.reason });
    if (classification.kind === "auth") {
      throw new ApiError(409, ERROR_CODE.connectionStateInvalid, "Sign in again to keep this connected.");
    }
    const name = getProvider(loaded.connection.provider_id)?.displayName ?? "The app";
    throw new ApiError(503, ERROR_CODE.providerUnavailable, `${name} didn't answer. Please try again in a few minutes.`);
  }
}

/** The provider's places, read live, for the "match your places" step. */
export async function listProviderLocations(
  orgId: string,
  connectionId: string,
  requestId: string,
): Promise<ProviderLocation[]> {
  await ownedConnection(orgId, connectionId, requestId);
  return withProvider(orgId, connectionId, requestId, async (loaded) => {
    const account = await loaded.adapter.discoverAccount(loaded.ctx.tokens);
    const svc = serviceRoleClient();
    await reportOutcome(svc, loaded.connection, "ok");
    return account.locations;
  });
}

export const configurationSchema = z.strictObject({
  mappings: z
    .array(
      z.strictObject({
        externalLocationId: z.string().min(1).max(200),
        locationId: z.string().regex(UUID_RE, "Choose one of your places."),
      }),
    )
    .min(1, "Choose at least one place.")
    .max(50),
});

/**
 * Save which provider place feeds which of the business's places. Provider
 * ids are checked against what the provider says exists right now; names and
 * time zones are taken from the provider, not the request.
 */
export async function saveConfiguration(
  context: OrganizationContext,
  connectionId: string,
  input: z.infer<typeof configurationSchema>,
  requestId: string,
): Promise<{ configVersion: number }> {
  const locations = await listProviderLocations(context.orgId, connectionId, requestId);
  const known = new Map(locations.map((location) => [location.externalLocationId, location]));

  const mappings = input.mappings.map((mapping) => {
    const location = known.get(mapping.externalLocationId);
    if (!location) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "One of those places no longer exists. Reload and try again.");
    }
    return {
      externalLocationId: location.externalLocationId,
      externalLocationName: location.name.slice(0, 120),
      externalTimezone: location.timezone,
      locationId: mapping.locationId,
    };
  });

  const { data, error } = await serviceRoleClient().rpc("rpc_integration_save_configuration", {
    p_connection_id: connectionId,
    p_org_id: context.orgId,
    p_mappings: mappings,
    p_actor: context.userId,
  });
  if (error) throw mapIntegrationRpcError(error, requestId);
  return { configVersion: Number(data) };
}

/**
 * The check before turning on: read a small recent sample and report counts.
 * Writes nothing but the result, so it can be run as often as the owner likes.
 */
export async function runTest(
  context: OrganizationContext,
  connectionId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<{ passed: boolean; summary: TestSummary }> {
  const owned = await ownedConnection(context.orgId, connectionId, requestId);
  // Through the caller's RLS (owners and admins), not the service role.
  const mappings = await listMappings(context.db, connectionId, requestId);
  if (mappings.length === 0) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "Choose at least one place first.");
  }
  const mapped = new Set(mappings.map((mapping) => mapping.externalLocationId));

  const summary = await withProvider(context.orgId, connectionId, requestId, async (loaded) => {
    const window = { start: new Date(now.getTime() - TEST_DAYS * 86_400_000), end: now };
    const visits: CanonicalVisitInput[] = [];
    let cursor: string | null = null;
    do {
      const page = await loaded.adapter.fetchVisits(loaded.ctx, loaded.workflow.id, window, cursor);
      visits.push(...page.items);
      cursor = page.next;
    } while (cursor && visits.length < TEST_SAMPLE);
    const sample = visits.slice(0, TEST_SAMPLE);

    const inPlaces = sample.filter((visit) => mapped.has(visit.externalLocationId));
    const ids = [...new Set(inPlaces.map((visit) => visit.customerExternalId).filter((id): id is string => Boolean(id)))];
    const customers = ids.length ? await loaded.adapter.fetchCustomersByIds(loaded.ctx, ids) : [];
    const reachable = new Set(
      customers.filter((customer) => normalizeProviderPhone(customer.phone).kind === "ok").map((customer) => customer.externalId),
    );

    const svc = serviceRoleClient();
    await reportOutcome(svc, loaded.connection, "ok");
    return {
      visitsFound: inPlaces.length,
      withCustomer: inPlaces.filter((visit) => visit.customerExternalId).length,
      reachable: inPlaces.filter((visit) => visit.customerExternalId && reachable.has(visit.customerExternalId)).length,
      noPhone: inPlaces.filter((visit) => visit.customerExternalId && !reachable.has(visit.customerExternalId)).length,
      otherPlaces: sample.length - inPlaces.length,
    } satisfies TestSummary;
  });

  const { error } = await serviceRoleClient().rpc("rpc_integration_record_test", {
    p_connection_id: connectionId,
    p_org_id: context.orgId,
    p_config_version: owned.config_version,
    p_passed: true,
    p_summary: summary,
  });
  if (error) throw mapIntegrationRpcError(error, requestId);
  return { passed: true, summary };
}

function workflowFor(providerId: string, workflowId: string) {
  const provider = getProvider(providerId);
  const workflow = provider ? getWorkflow(provider, workflowId) : null;
  if (!workflow) throw new ApiError(409, ERROR_CODE.providerUnavailable, "That app can't be used right now.");
  return workflow;
}

/** Turn on: the database checks the last test matches the current settings, then queues the first read. */
export async function activate(
  context: OrganizationContext,
  connectionId: string,
  requestId: string,
): Promise<{ queuedRuns: number }> {
  const owned = await ownedConnection(context.orgId, connectionId, requestId);
  const workflow = workflowFor(owned.provider_id, owned.workflow_id);
  const { data, error } = await serviceRoleClient().rpc("rpc_integration_activate", {
    p_connection_id: connectionId,
    p_org_id: context.orgId,
    p_actor: context.userId,
    p_streams: [workflow.stream],
    p_window_days: BACKFILL_DAYS,
  });
  if (error) throw mapIntegrationRpcError(error, requestId);
  return { queuedRuns: Array.isArray(data) ? data.length : 0 };
}

/**
 * "Update now". Repeated taps within a few minutes share one run, because the
 * idempotency key is bucketed by time.
 */
export async function syncNow(
  context: OrganizationContext,
  connectionId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<{ runId: string; created: boolean }> {
  const owned = await ownedConnection(context.orgId, connectionId, requestId);
  if (owned.state !== "active") {
    throw new ApiError(409, ERROR_CODE.connectionStateInvalid, "Turn this connection on first.");
  }
  const workflow = workflowFor(owned.provider_id, owned.workflow_id);
  const svc = serviceRoleClient();
  const { data: checkpoint } = await svc.rpc("rpc_integration_checkpoint_high_water", {
    p_connection_id: connectionId,
    p_stream: workflow.stream,
  });
  const highWater = (checkpoint as string | null | undefined) ?? null;
  const start = highWater
    ? new Date(new Date(highWater).getTime() - 15 * 60_000)
    : new Date(now.getTime() - BACKFILL_DAYS * 86_400_000);

  const bucket = Math.floor(now.getTime() / (MANUAL_BUCKET_SECONDS * 1000));
  const { data, error } = await svc.rpc("rpc_integration_enqueue_run", {
    p_connection_id: connectionId,
    p_org_id: context.orgId,
    p_kind: "manual",
    p_stream: workflow.stream,
    p_idempotency_key: `manual:${bucket}:${workflow.stream}`,
    p_window_start: start.toISOString(),
    p_window_end: now.toISOString(),
  });
  if (error) throw mapIntegrationRpcError(error, requestId);
  const row = firstRow<{ run_id: string; created: boolean }>(data);
  if (!row) throw mapIntegrationRpcError(null, requestId);
  return { runId: row.run_id, created: row.created };
}

/**
 * Disconnect. Syncing stops at once; the provider is asked to revoke access,
 * a few times if it is slow; the stored tokens are deleted either way. Data
 * already brought in is kept for 30 days so a reconnect can restore it.
 */
export async function disconnect(
  context: OrganizationContext,
  connectionId: string,
  requestId: string,
): Promise<{ state: string; revoked: boolean }> {
  await ownedConnection(context.orgId, connectionId, requestId);
  const svc = serviceRoleClient();

  // Load the tokens before they are deleted, so access can be revoked.
  let loaded: Awaited<ReturnType<typeof loadConnection>> | null = null;
  try {
    loaded = await loadConnection(svc, connectionId);
  } catch (caught) {
    logger.warn("integrations.disconnect_without_tokens", { requestId, connectionId, error: caught });
  }

  const { error: beginError } = await svc.rpc("rpc_integration_begin_disconnect", {
    p_connection_id: connectionId,
    p_org_id: context.orgId,
    p_actor: context.userId,
    p_reason: "owner_disconnected",
  });
  if (beginError) throw mapIntegrationRpcError(beginError, requestId);

  let revoked = false;
  if (loaded) {
    for (let attempt = 0; attempt < 3 && !revoked; attempt += 1) {
      try {
        await loaded.adapter.revoke(loaded.ctx.tokens);
        revoked = true;
      } catch (caught) {
        logger.warn("integrations.revoke_failed", { requestId, connectionId, attempt, error: caught });
      }
    }
  }

  const { data, error } = await svc.rpc("rpc_integration_finish_disconnect", {
    p_connection_id: connectionId,
    p_org_id: context.orgId,
    p_revoke_outcome: revoked ? "revoked" : "revoke_failed",
  });
  if (error) throw mapIntegrationRpcError(error, requestId);
  return { state: String(data), revoked };
}
