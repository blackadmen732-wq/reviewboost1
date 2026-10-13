import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { encrypt } from "@/lib/server/crypto";
import { getAdapter } from "@/lib/server/integrations/adapters";
import {
  openTokens,
  sealTokens,
  type CredentialBinding,
  type CredentialRow,
} from "@/lib/server/integrations/credentials";
import { cleanName, displayHint, nameDigest, normalizeProviderPhone } from "@/lib/server/integrations/normalize";
import { getProvider, getWorkflow, type WorkflowDefinition } from "@/lib/server/integrations/registry";
import {
  ProviderError,
  type CanonicalCustomerInput,
  type CanonicalVisitInput,
  type ProviderAdapter,
  type ProviderErrorClass,
  type SyncContext,
} from "@/lib/server/integrations/types";
import { logger } from "@/lib/server/logger";

/**
 * The shared middle of every sync path: load a connection with usable
 * tokens, and apply canonical records through the database's idempotent
 * upserts. Used by sync runs and by webhook events alike, so both produce the
 * same contacts, visits and issues for the same data.
 */

export interface ConnectionRow {
  id: string;
  org_id: string;
  provider_id: string;
  workflow_id: string;
  external_account_id: string;
  state: string;
  granted_scopes: string[] | null;
}

export interface LoadedConnection {
  connection: ConnectionRow;
  adapter: ProviderAdapter;
  workflow: WorkflowDefinition;
  ctx: SyncContext;
  binding: CredentialBinding;
  /** Provider places the owner chose. Visits anywhere else are not brought in. */
  mappedLocations: ReadonlySet<string>;
}

export class ConnectionUnavailableError extends Error {
  constructor(readonly code: "connection_not_found" | "provider_not_available" | "credentials_missing") {
    super(code);
    this.name = "ConnectionUnavailableError";
  }
}

const CONNECTION_COLUMNS = "id, org_id, provider_id, workflow_id, external_account_id, state, granted_scopes";

/**
 * Load a connection and its tokens, refreshing them first when the adapter
 * says they are due. Refresh is single-flight across workers; a worker that
 * loses the race uses the tokens it has, which are still valid.
 */
export async function loadConnection(
  svc: SupabaseClient,
  connectionId: string,
  now: Date = new Date(),
): Promise<LoadedConnection> {
  const { data: connection, error } = await svc
    .from("integration_connections")
    .select(CONNECTION_COLUMNS)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw error;
  if (!connection) throw new ConnectionUnavailableError("connection_not_found");

  const row = connection as ConnectionRow;
  const adapter = getAdapter(row.provider_id);
  const provider = getProvider(row.provider_id);
  const workflow = provider ? getWorkflow(provider, row.workflow_id) : null;
  if (!adapter || !workflow) throw new ConnectionUnavailableError("provider_not_available");

  const { data: credentials, error: credError } = await svc
    .from("integration_credentials")
    .select("access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, last_refreshed_at")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (credError) throw credError;
  if (!credentials) throw new ConnectionUnavailableError("credentials_missing");

  const binding: CredentialBinding = {
    orgId: row.org_id,
    providerId: row.provider_id,
    externalAccountId: row.external_account_id,
  };
  const credentialRow = credentials as CredentialRow;
  let tokens = openTokens(credentialRow, binding, row.granted_scopes ?? []);

  const lastRefreshed = credentialRow.last_refreshed_at ? new Date(credentialRow.last_refreshed_at) : null;
  if (adapter.shouldRefresh(tokens, lastRefreshed, now)) {
    tokens = await refreshTokens(svc, row, adapter, tokens, binding);
  }

  const { data: mappings, error: mappingError } = await svc
    .from("integration_location_mappings")
    .select("external_location_id")
    .eq("connection_id", connectionId);
  if (mappingError) throw mappingError;

  return {
    connection: row,
    adapter,
    workflow,
    ctx: { tokens, externalAccountId: row.external_account_id },
    binding,
    mappedLocations: new Set(((mappings ?? []) as Array<{ external_location_id: string }>).map((m) => m.external_location_id)),
  };
}

async function refreshTokens(
  svc: SupabaseClient,
  connection: ConnectionRow,
  adapter: ProviderAdapter,
  tokens: LoadedConnection["ctx"]["tokens"],
  binding: CredentialBinding,
): Promise<LoadedConnection["ctx"]["tokens"]> {
  const { data: locked, error } = await svc.rpc("rpc_integration_lock_refresh", {
    p_connection_id: connection.id,
    p_seconds: 60,
  });
  if (error) throw error;
  if (locked !== true) return tokens;

  let refreshed;
  try {
    refreshed = await adapter.refresh(tokens);
  } catch (caught) {
    const classification = adapter.classifyError(caught);
    if (classification.kind === "auth") {
      await reportOutcome(svc, connection, classification);
      throw new ProviderError(classification);
    }
    // A failed refresh of a still-valid token is not fatal; try again later.
    logger.warn("integrations.refresh_failed", { connectionId: connection.id, reason: classification.reason });
    return tokens;
  }

  const sealed = sealTokens(refreshed, binding);
  const { error: storeError } = await svc.rpc("rpc_integration_store_credentials", {
    p_connection_id: connection.id,
    p_org_id: connection.org_id,
    p_key_version: sealed.keyVersion,
    p_access_token_enc: sealed.accessTokenEnc,
    p_refresh_token_enc: sealed.refreshTokenEnc,
    p_access_expires_at: sealed.accessExpiresAt,
    p_refresh_expires_at: sealed.refreshExpiresAt,
    p_refreshed: true,
  });
  if (storeError) throw storeError;
  return refreshed;
}

/** Tell the database what a provider call said about the connection's health. */
export async function reportOutcome(
  svc: SupabaseClient,
  connection: Pick<ConnectionRow, "id" | "org_id">,
  outcome: ProviderErrorClass | "ok",
): Promise<void> {
  if (outcome !== "ok" && outcome.kind === "permanent") return;
  const { error } = await svc.rpc("rpc_integration_report_outcome", {
    p_connection_id: connection.id,
    p_org_id: connection.org_id,
    p_outcome: outcome === "ok" ? "ok" : outcome.kind,
    p_error_code: outcome === "ok" ? null : outcome.reason,
  });
  if (error) logger.error("integrations.report_outcome_failed", { connectionId: connection.id, error });
}

export type Counts = Record<string, number>;

function bump(counts: Counts, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
}

interface IssueRef {
  runId: string | null;
  inboxId: string | null;
}

async function recordIssue(
  svc: SupabaseClient,
  connection: ConnectionRow,
  ref: IssueRef,
  objectType: "customer" | "visit",
  externalId: string,
  issueCode: string,
  hint: string | null,
): Promise<void> {
  const { error } = await svc.rpc("rpc_integration_record_issue", {
    p_connection_id: connection.id,
    p_org_id: connection.org_id,
    p_run_id: ref.runId,
    p_inbox_id: ref.inboxId,
    p_object_type: objectType,
    p_external_id: externalId,
    p_issue_code: issueCode,
    p_display_hint: hint,
  });
  if (error) throw error;
}

async function resolveIssues(
  svc: SupabaseClient,
  connection: ConnectionRow,
  objectType: "customer" | "visit",
  externalId: string,
): Promise<void> {
  const { error } = await svc.rpc("rpc_integration_resolve_issues", {
    p_connection_id: connection.id,
    p_object_type: objectType,
    p_external_id: externalId,
  });
  if (error) throw error;
}

/**
 * Apply customers. A customer with no usable phone is not a contact: it is an
 * issue the owner can see, with a hint that never shows the whole number.
 */
export async function applyCustomers(
  svc: SupabaseClient,
  connection: ConnectionRow,
  customers: readonly CanonicalCustomerInput[],
  ref: IssueRef,
  counts: Counts,
): Promise<Set<string>> {
  const applied = new Set<string>();

  for (const customer of customers) {
    const name = cleanName(customer.name);
    const phone = normalizeProviderPhone(customer.phone);

    if (phone.kind !== "ok") {
      await recordIssue(
        svc,
        connection,
        ref,
        "customer",
        customer.externalId,
        phone.kind === "missing" ? "no_phone" : "invalid_phone",
        displayHint(name, customer.phone),
      );
      bump(counts, "skipped");
      continue;
    }

    const { data, error } = await svc.rpc("rpc_integration_apply_customer", {
      p_connection_id: connection.id,
      p_org_id: connection.org_id,
      p_external_id: customer.externalId,
      p_phone_hash: phone.stored.phoneHash,
      p_phone_encrypted: phone.stored.phoneEncrypted,
      p_phone_key_version: phone.stored.phoneKeyVersion,
      p_phone_last_four: phone.stored.lastFour,
      p_name_encrypted: name ? encrypt(name) : null,
      p_name_digest: name ? nameDigest(name) : null,
      p_source_created_at: customer.sourceCreatedAt?.toISOString() ?? null,
      p_source_updated_at: customer.sourceUpdatedAt?.toISOString() ?? null,
      p_source_version: customer.sourceVersion,
    });
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | undefined;
    bump(counts, `customers_${row?.outcome ?? "unknown"}`);
    applied.add(customer.externalId);
    await resolveIssues(svc, connection, "customer", customer.externalId);
  }

  return applied;
}

export async function applyVisits(
  svc: SupabaseClient,
  connection: ConnectionRow,
  visits: readonly CanonicalVisitInput[],
  ref: IssueRef,
  counts: Counts,
): Promise<void> {
  for (const visit of visits) {
    if (!visit.customerExternalId) {
      await recordIssue(svc, connection, ref, "visit", visit.externalId, "no_customer", null);
      bump(counts, "skipped");
      continue;
    }

    const { data, error } = await svc.rpc("rpc_integration_apply_visit", {
      p_connection_id: connection.id,
      p_org_id: connection.org_id,
      p_kind: visit.kind,
      p_external_id: visit.externalId,
      p_customer_external_id: visit.customerExternalId,
      p_external_location_id: visit.externalLocationId,
      p_status: visit.status,
      p_occurred_at: visit.occurredAt.toISOString(),
      p_source_updated_at: visit.sourceUpdatedAt?.toISOString() ?? null,
      p_source_version: visit.sourceVersion,
    });
    if (error) throw error;

    const outcome = ((Array.isArray(data) ? data[0] : data) as { outcome?: string } | undefined)?.outcome;
    if (outcome === "location_not_mapped" || outcome === "no_customer") {
      // no_customer here means the customer exists at the source but could
      // not become a contact (no usable phone); that customer has its own issue.
      await recordIssue(
        svc,
        connection,
        ref,
        "visit",
        visit.externalId,
        outcome === "no_customer" ? "customer_not_reachable" : "location_not_mapped",
        null,
      );
      bump(counts, "skipped");
      continue;
    }

    bump(counts, `visits_${outcome ?? "unknown"}`);
    await resolveIssues(svc, connection, "visit", visit.externalId);
  }
}

/**
 * Visits at places the owner left out go no further: neither they nor the
 * customers on them are brought in. That is the owner's choice, not a
 * problem, so it is counted rather than listed as an issue.
 */
function keepChosenPlaces(
  loaded: LoadedConnection,
  visits: readonly CanonicalVisitInput[],
  counts: Counts,
): CanonicalVisitInput[] {
  const kept = visits.filter((visit) => loaded.mappedLocations.has(visit.externalLocationId));
  if (visits.length > kept.length) bump(counts, "visits_other_places", visits.length - kept.length);
  return kept;
}

function referencedCustomerIds(visits: readonly CanonicalVisitInput[]): string[] {
  return [...new Set(visits.map((v) => v.customerExternalId).filter((id): id is string => Boolean(id)))];
}

/**
 * Apply a batch of visits: fetch only the customers those visits reference
 * (never the whole customer directory), apply them, then the visits.
 */
export async function applyVisitBatch(
  svc: SupabaseClient,
  loaded: LoadedConnection,
  visits: readonly CanonicalVisitInput[],
  ref: IssueRef,
  counts: Counts,
): Promise<void> {
  const kept = keepChosenPlaces(loaded, visits, counts);
  const ids = referencedCustomerIds(kept);
  const customers = ids.length ? await loaded.adapter.fetchCustomersByIds(loaded.ctx, ids) : [];
  await applyCustomers(svc, loaded.connection, customers, ref, counts);
  await applyVisits(svc, loaded.connection, kept, ref, counts);
}

/**
 * Apply what a webhook event resolved to. Customers come in only as part of a
 * visit at a chosen place; `heldCustomers` are already this connection's and
 * may be updated on their own.
 */
export async function applyResolved(
  svc: SupabaseClient,
  loaded: LoadedConnection,
  customers: readonly CanonicalCustomerInput[],
  visits: readonly CanonicalVisitInput[],
  heldCustomers: ReadonlySet<string>,
  ref: IssueRef,
  counts: Counts,
): Promise<void> {
  const kept = keepChosenPlaces(loaded, visits, counts);
  const wanted = new Set([...referencedCustomerIds(kept), ...heldCustomers]);
  await applyCustomers(svc, loaded.connection, customers.filter((c) => wanted.has(c.externalId)), ref, counts);
  await applyVisits(svc, loaded.connection, kept, ref, counts);
}
