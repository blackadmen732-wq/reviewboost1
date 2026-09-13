import "server-only";

/**
 * Feature flags for Customer Page V2 rollout.
 *
 * Two independent flags so activation is separable:
 *
 * - `CUSTOMER_PAGE_EDITOR_ENABLED` gates the owner API surface for editing
 *   and publishing the branded customer page. Off by default; when off the
 *   owner routes 404 rather than exposing an unfinished editor. The
 *   database schema is additive and safe with the flag off.
 *
 * - `CUSTOMER_FLOW_V2_ENABLED` gates the public-facing changes to the
 *   `/api/v1/public/q/{token}` context: whether the response carries the
 *   `customerPage` presentation object, whether the client should assume
 *   the V2 one-tap → Google handoff. Off by default so already-shipped
 *   frontends keep seeing exactly today's payload.
 *
 * Rollback is turning a flag off, not reversing a production migration.
 * Flags are read on every access rather than at module load so a
 * pod-level env change is picked up on the next request without a
 * cold-start.
 */

function boolFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function customerPageEditorEnabled(): boolean {
  return boolFlag("CUSTOMER_PAGE_EDITOR_ENABLED");
}

export function customerFlowV2Enabled(): boolean {
  return boolFlag("CUSTOMER_FLOW_V2_ENABLED");
}
