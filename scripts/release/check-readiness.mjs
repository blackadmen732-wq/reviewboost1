#!/usr/bin/env node
// Promotion gate: ask a candidate deployment whether it can serve paying
// customers, and exit non-zero unless it says yes.
//
//   READINESS_URL=https://<candidate-deployment> \
//   WORKER_SECRET=<CRON_SECRET of that environment> \
//   node scripts/release/check-readiness.mjs
//
// Checks the configuration gate (/internal/readiness, which also proves the
// database is at this build's schema and the Stripe price map agrees) and the
// operational health (/internal/health, where data.ok=false is a failure even
// with a 200). Prints problems, never secrets.

const base = (process.env.READINESS_URL ?? "").replace(/\/+$/, "");
const secret = process.env.WORKER_SECRET ?? "";
if (!base || !secret) {
  console.error("READINESS_URL and WORKER_SECRET are required.");
  process.exit(2);
}

async function probe(path) {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(20_000),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON answer is itself a failure, reported below.
  }
  return { status: response.status, body };
}

let failed = false;

const readiness = await probe("/api/v1/internal/readiness");
const report = readiness.body?.data;
if (readiness.status !== 200 || report?.ok !== true) {
  failed = true;
  console.error(`readiness: NOT READY (HTTP ${readiness.status}, tier ${report?.tier ?? "unknown"})`);
  for (const p of report?.problems ?? []) console.error(`  [${p.subsystem}] ${p.problem}`);
  if (readiness.status === 404) console.error("  404: wrong WORKER_SECRET, or the deployment predates the gate.");
} else {
  console.log(`readiness: ok (tier ${report.tier})`);
}

const health = await probe("/api/v1/internal/health");
if (health.body?.data?.ok !== true) {
  failed = true;
  console.error(`health: UNHEALTHY (HTTP ${health.status}) ${JSON.stringify(health.body?.data?.problems ?? [])}`);
} else {
  console.log("health: ok");
}

process.exit(failed ? 1 : 0);
