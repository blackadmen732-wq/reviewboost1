import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The service-role key bypasses row level security. This makes its use a
 * reviewed list rather than a convention:
 *
 *   1. Only the files below may import `serviceRoleClient`. A new importer
 *      fails here until someone decides it belongs and adds it, with a reason.
 *   2. No service-role client — called directly or through a variable — may
 *      query a table with `.from(...)`. Tenant reads go through the caller's
 *      own client (`context.db`, under RLS); privileged work goes through a
 *      narrow `rpc_*` function that establishes its own tenant.
 *   3. Storage administration and Auth administration are allowed only in
 *      the modules that exist to do them.
 *
 * It is a static check, so it errs strict: a pattern it cannot prove safe is
 * a failure to look at, not something to work around.
 */

const ROOT = join(__dirname, "..", "..");

const IMPORTERS: Record<string, string> = {
  "app/api/v1/text-requests/consent/route.ts": "owner/admin authenticated first; organization rate-limit RPC only; evidence is recorded by the reviewed SMS service",
  "lib/server/supabase.ts": "defines the client",
  "lib/server/billing-service.ts": "Stripe webhook inbox and billing RPCs (no user session exists)",
  "lib/server/customer-flow-service.ts": "anonymous public review flow: capability-scoped rpc_* only",
  "lib/server/customer-page-service.ts": "Storage: signed upload URLs and upload confirmation",
  "lib/server/sms/dispatch.ts": "scheduled SMS worker: outbox RPCs",
  "lib/server/sms/text-request-service.ts": "SMS enqueue/consent RPCs",
  "lib/server/sms/webhook-service.ts": "provider webhook inbox RPCs (no user session exists)",
  "lib/server/heartbeat.ts": "worker heartbeat RPC",
  // App Review's demo sign-in: off unless REVIEW_SIGN_IN_EMAIL and _CODE are
  // set, one server-chosen account, rate limited per client and overall,
  // constant-time compare; mints a one-time magic-link token hash only.
  "lib/server/review-sign-in.ts": "rate-limit RPC and Auth Admin generateLink for the one review account",
  "app/api/v1/account/deletion/route.ts": "Auth Admin deleteUser, billing refs lookup",
  // Deleting your own login (launch gap L1): deleteUser for the session's own
  // id only, after rpc_my_account_deletion_blockers (read as the caller) is empty.
  "app/api/v1/account/personal-deletion/route.ts": "Auth Admin deleteUser of the caller's own login",
  "app/api/v1/internal/health/route.ts": "operator health RPCs",
  "app/api/v1/internal/maintenance/route.ts": "scheduled maintenance RPCs",
  "app/api/v1/internal/readiness/route.ts": "readiness: catalog RPC and Storage bucket check",
  "app/api/v1/text-requests/route.ts": "per-organization rate-limit RPC (the bucket table is service-only)",
};

const STORAGE_ALLOWED = new Set([
  "lib/server/customer-page-service.ts",
  "app/api/v1/internal/readiness/route.ts",
]);
const AUTH_ADMIN_ALLOWED = new Set([
  "app/api/v1/account/deletion/route.ts",
  "app/api/v1/account/personal-deletion/route.ts",
  // generateLink for the single configured App Review account; see IMPORTERS.
  "lib/server/review-sign-in.ts",
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = [...sources(join(ROOT, "lib")), ...sources(join(ROOT, "app"))].map((path) => ({
  path: relative(ROOT, path).split("\\").join("/"),
  text: readFileSync(path, "utf8"),
}));

const users = files.filter((file) => /\bserviceRoleClient\b/.test(file.text));

/** `serviceRoleClient()` itself, and every name a result of it is bound to. */
function receivers(text: string): string[] {
  const aliases = [...text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*serviceRoleClient\(\)\s*;/g)].map(
    (match) => `\\b${match[1]}`,
  );
  return ["serviceRoleClient\\(\\)", ...aliases];
}

describe("service-role containment", () => {
  it("is imported only by reviewed modules", () => {
    const unreviewed = users.map((file) => file.path).filter((path) => !(path in IMPORTERS));
    expect(unreviewed).toEqual([]);
  });

  it("never queries a table directly", () => {
    const offenders = users.flatMap((file) =>
      receivers(file.text).flatMap((receiver) =>
        new RegExp(`${receiver}\\s*(?:\\.\\s*schema\\([^)]*\\)\\s*)?\\.\\s*from\\s*\\(`).test(file.text)
          ? [`${file.path}: ${receiver.replace(/\\\\|\\b/g, "")}.from(...)`]
          : [],
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("administers Storage only where uploads are handled", () => {
    const offenders = users
      .filter((file) => receivers(file.text).some((r) => new RegExp(`${r}\\s*\\.\\s*storage\\b`).test(file.text)))
      .map((file) => file.path)
      .filter((path) => !STORAGE_ALLOWED.has(path));
    expect(offenders).toEqual([]);
  });

  it("administers Auth only in account deletion and the App Review sign-in", () => {
    const offenders = users
      .filter((file) => receivers(file.text).some((r) => new RegExp(`${r}\\s*\\.\\s*auth\\b`).test(file.text)))
      .map((file) => file.path)
      .filter((path) => !AUTH_ADMIN_ALLOWED.has(path));
    expect(offenders).toEqual([]);
  });

  it("is never passed around as a value, which would hide every use above", () => {
    // e.g. `doThing(serviceRoleClient())` or `return serviceRoleClient()` in a
    // helper: the receiver is no longer visible to this check.
    const offenders = users
      .filter((file) => file.path !== "lib/server/supabase.ts")
      .flatMap((file) =>
        [...file.text.matchAll(/serviceRoleClient\(\)(?!\s*\.)/g)]
          .map((match) => file.text.slice(Math.max(0, match.index - 40), match.index))
          .filter((before) => !/(?:const|let|var)\s+\w+\s*=\s*$/.test(before))
          .map(() => file.path),
      );
    expect(offenders).toEqual([]);
  });

  it("catches a table query when one is planted (the check itself works)", () => {
    const planted = `const svc = serviceRoleClient();\nawait svc\n  .from("customer_responses").select("*");`;
    const hit = receivers(planted).some((receiver) =>
      new RegExp(`${receiver}\\s*(?:\\.\\s*schema\\([^)]*\\)\\s*)?\\.\\s*from\\s*\\(`).test(planted),
    );
    expect(hit).toBe(true);
  });

  // supabase/config.toml exposes only `public` to the Data API. A call through
  // `.schema("...")` reaches nothing in production and every request fails —
  // which account deletion did, behind a unit test that mocked `.schema()`.
  it("never asks the Data API for a schema it does not serve", () => {
    const offenders = files
      .filter((file) => /\.schema\(\s*["'`]/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
