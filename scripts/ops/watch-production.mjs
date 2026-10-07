#!/usr/bin/env node
// Is production up, and is it healthy? Exit non-zero if not.
//
//   SITE_URL=https://reviewboost.fit \
//   WORKER_SECRET=<production CRON_SECRET, optional> \
//   REPORT_FILE=report.md \
//   node scripts/ops/watch-production.mjs
//
// Always checks that the public homepage answers 200. With WORKER_SECRET it
// also reads /internal/readiness and /internal/health, which see the database,
// the scheduler, the queues and the configuration — the failures a homepage
// check cannot. A check that fails is retried once a minute later, so one
// dropped request is not an alert; only a failure that is still there is.
//
// Prints and writes problems, never secrets. Used by
// .github/workflows/production-watch.yml.

import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RETRY_AFTER_MS = 60_000;
const TIMEOUT_MS = 20_000;

async function request(fetchImpl, url, secret) {
  try {
    const response = await fetchImpl(url, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // The homepage is HTML, and a broken endpoint may not answer JSON.
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: null, error: error?.name ?? "request failed" };
  }
}

/** One pass over every check. Returns the problems found, empty when fine. */
export async function checkOnce({ base, secret, fetchImpl }) {
  const problems = [];

  const home = await request(fetchImpl, `${base}/`);
  if (home.status !== 200) {
    problems.push(
      `homepage: HTTP ${home.status || `no answer (${home.error})`} — the site is not serving`,
    );
  }

  if (secret) {
    const readiness = await request(fetchImpl, `${base}/api/v1/internal/readiness`, secret);
    const report = readiness.body?.data;
    if (readiness.status === 404) {
      problems.push(
        "readiness: HTTP 404 — PRODUCTION_CRON_SECRET does not match CRON_SECRET in Vercel, or the deployment predates the gate",
      );
    } else if (readiness.status !== 200 || report?.ok !== true) {
      const detail = (report?.problems ?? []).map((p) => `${p.subsystem}: ${p.problem}`);
      problems.push(
        `readiness: not ready (HTTP ${readiness.status || "no answer"})${detail.length ? ` — ${detail.join("; ")}` : ""}`,
      );
    }

    const health = await request(fetchImpl, `${base}/api/v1/internal/health`, secret);
    const data = health.body?.data;
    if (health.status !== 404 && data?.ok !== true) {
      const detail = data?.problems ?? [];
      problems.push(
        `health: unhealthy (HTTP ${health.status || "no answer"})${detail.length ? ` — ${detail.join(", ")}` : ""}`,
      );
    }
  }

  return problems;
}

/**
 * Checks, and on failure checks again after a pause. A problem counts only if
 * the second pass still has one, and the second pass's problems are the ones
 * reported, because they are the current state.
 */
export async function watch({ base, secret, fetchImpl = fetch, sleep = defaultSleep }) {
  const first = await checkOnce({ base, secret, fetchImpl });
  if (first.length === 0) return { ok: true, problems: [], deep: Boolean(secret) };

  await sleep(RETRY_AFTER_MS);
  const second = await checkOnce({ base, secret, fetchImpl });
  return { ok: second.length === 0, problems: second, deep: Boolean(secret) };
}

export function formatReport({ base, result, at }) {
  const lines = [`Checked ${base} at ${at}.`, ""];
  if (result.ok) {
    lines.push("Production is up and healthy.");
  } else {
    lines.push("**Production is down or unhealthy:**", "");
    for (const problem of result.problems) lines.push(`- ${problem}`);
    lines.push("", "What each problem means and what to do first: docs/backend/OPERATIONS.md §1.");
  }
  if (!result.deep) {
    lines.push(
      "",
      "Only the homepage was checked. Set the repository secret PRODUCTION_CRON_SECRET (the same value as CRON_SECRET in Vercel) to also check the database, scheduler, queues and configuration.",
    );
  }
  return lines.join("\n");
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const base = (process.env.SITE_URL || "https://reviewboost.fit").replace(/\/+$/, "");
  const secret = process.env.WORKER_SECRET || "";

  const result = await watch({ base, secret });
  const report = formatReport({ base, result, at: new Date().toISOString() });

  console.log(report);
  if (process.env.REPORT_FILE) writeFileSync(process.env.REPORT_FILE, `${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (!result.deep) console.log("::notice::Deep checks skipped: PRODUCTION_CRON_SECRET is not set.");

  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
