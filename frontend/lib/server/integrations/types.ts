import "server-only";

/**
 * The contract every provider adapter implements, and the canonical shapes
 * that cross it (docs/connections/04).
 *
 * An adapter knows one provider's API and nothing about ReviewBoost's
 * database: it authenticates, reads, and maps the provider's objects into the
 * small canonical records below. The sync runner owns everything else —
 * tenancy, idempotency, ordering, persistence — so a second provider is a new
 * adapter, never a change to the pipeline.
 */

export type ProviderId = "square" | "fake";

export type WorkflowId = "payments" | "appointments";

export type VisitKind = "payment" | "appointment";

export type VisitStatus =
  | "completed"
  | "appointment_time_passed"
  | "pending"
  | "cancelled"
  | "no_show";

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  /** The scopes the provider actually granted, which may be fewer than asked for. */
  grantedScopes: readonly string[];
}

export interface ProviderLocation {
  externalLocationId: string;
  name: string;
  timezone: string | null;
}

export interface ProviderAccount {
  externalAccountId: string;
  /** The account's own name, for the owner to recognise ("Corner Cafe LLC"). */
  label: string | null;
  locations: ProviderLocation[];
}

/** A customer as the provider describes them, before phone normalisation. */
export interface CanonicalCustomerInput {
  externalId: string;
  name: string | null;
  /** Raw phone as the provider has it. Normalised by the runner, never trusted. */
  phone: string | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceVersion: number | null;
}

export interface CanonicalVisitInput {
  externalId: string;
  kind: VisitKind;
  status: VisitStatus;
  /** Null when the provider attached no customer to this sale or booking. */
  customerExternalId: string | null;
  externalLocationId: string;
  occurredAt: Date;
  sourceUpdatedAt: Date | null;
  sourceVersion: number | null;
}

export interface Page<T> {
  items: T[];
  /** Opaque; null when there is nothing more. */
  next: string | null;
}

export interface SyncWindow {
  start: Date;
  end: Date;
}

export interface SyncContext {
  tokens: TokenSet;
  externalAccountId: string;
  /**
   * The provider's places the owner chose. A provider that answers one place
   * per call (Square's payments) reads only these; others may ignore it.
   */
  locationIds?: readonly string[];
}

export interface ParsedEvent {
  providerEventId: string;
  externalAccountId: string;
  type: string;
  objectType: "customer" | "payment" | "booking" | "authorization" | "other";
  objectId: string | null;
  objectVersion: number | null;
  occurredAt: Date;
  /** Bumps whenever this adapter's parsing changes, so stored rows say which parser read them. */
  payloadVersion: string;
}

/** What an event turned out to mean once the current object was re-read. */
export interface ResolvedEvent {
  customers: CanonicalCustomerInput[];
  visits: CanonicalVisitInput[];
  /** The provider says our access was removed from its side. */
  revoked: boolean;
}

export interface GrantCheck {
  sufficient: boolean;
  missing: readonly string[];
}

export type ProviderErrorClass =
  | {
      kind: "retryable";
      reason: "rate_limited" | "server_error" | "timeout" | "network";
      retryAfterMs?: number;
    }
  | { kind: "auth"; reason: "token_expired" | "token_revoked" | "insufficient_scope" }
  | { kind: "permanent"; reason: "not_found" | "invalid_request" | "unsupported" | "location_gone" };

/** Thrown by adapters, already classified. */
export class ProviderError extends Error {
  readonly classification: ProviderErrorClass;

  constructor(classification: ProviderErrorClass, message?: string) {
    super(message ?? `${classification.kind}:${classification.reason}`);
    this.name = "ProviderError";
    this.classification = classification;
  }
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly apiVersion: string;

  // Authentication and credential lifecycle
  buildAuthorizeUrl(input: { state: string; scopes: readonly string[]; redirectUri: string }): URL;
  exchangeCode(input: { code: string; redirectUri: string; requestedScopes: readonly string[] }): Promise<TokenSet>;
  refresh(tokens: TokenSet): Promise<TokenSet>;
  revoke(tokens: TokenSet): Promise<void>;
  shouldRefresh(tokens: TokenSet, lastRefreshedAt: Date | null, now: Date): boolean;

  // Permission and identity verification
  verifyGrant(tokens: TokenSet, requested: readonly string[]): GrantCheck;
  discoverAccount(tokens: TokenSet): Promise<ProviderAccount>;

  // Synchronisation
  fetchVisits(
    ctx: SyncContext,
    workflow: WorkflowId,
    window: SyncWindow,
    cursor: string | null,
  ): Promise<Page<CanonicalVisitInput>>;
  fetchCustomersByIds(ctx: SyncContext, externalIds: readonly string[]): Promise<CanonicalCustomerInput[]>;

  // Webhooks
  verifyWebhook(input: { rawBody: string; headers: Headers; url: string }): boolean;
  parseWebhook(rawBody: string): ParsedEvent;
  resolveEvent(ctx: SyncContext, event: ParsedEvent): Promise<ResolvedEvent>;

  // Errors
  classifyError(error: unknown): ProviderErrorClass;
}
