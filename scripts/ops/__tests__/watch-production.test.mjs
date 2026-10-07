import assert from "node:assert/strict";
import { test } from "node:test";

import { checkOnce, formatReport, watch } from "../watch-production.mjs";

const BASE = "https://example.test";

/** A fetch that answers from a table of path -> [status, body], in turn. */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, auth: init?.headers?.authorization ?? null });
    const queue = routes[path];
    if (!queue || queue.length === 0) throw new Error(`unexpected request ${path}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === "network") throw Object.assign(new Error("boom"), { name: "TypeError" });
    const [status, body] = next;
    return {
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError("not json");
        return body;
      },
    };
  };
  return { fetchImpl, calls };
}

const healthy = {
  "/": [[200]],
  "/api/v1/internal/readiness": [[200, { data: { ok: true, tier: "production", problems: [] } }]],
  "/api/v1/internal/health": [[200, { data: { ok: true, problems: [] } }]],
};

test("a healthy production passes, and the secret goes only to the internal endpoints", async () => {
  const { fetchImpl, calls } = fakeFetch(structuredClone(healthy));
  const result = await watch({ base: BASE, secret: "s3cret", fetchImpl, sleep: async () => {} });

  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.equal(calls.find((c) => c.path === "/").auth, null);
  assert.equal(calls.find((c) => c.path === "/api/v1/internal/health").auth, "Bearer s3cret");
});

test("one failed request followed by a good one is not an alert", async () => {
  const { fetchImpl } = fakeFetch({ ...structuredClone(healthy), "/": [[502], [200]] });
  let slept = 0;
  const result = await watch({
    base: BASE,
    secret: "s3cret",
    fetchImpl,
    sleep: async (ms) => {
      slept = ms;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(slept, 60_000);
});

test("a homepage that stays down is reported", async () => {
  const { fetchImpl } = fakeFetch({ "/": ["network", "network"] });
  const result = await watch({ base: BASE, secret: "", fetchImpl, sleep: async () => {} });

  assert.equal(result.ok, false);
  assert.match(result.problems[0], /homepage: HTTP no answer/);
});

test("an unhealthy 503 names its problems", async () => {
  const { fetchImpl } = fakeFetch({
    ...structuredClone(healthy),
    "/api/v1/internal/health": [[503, { data: { ok: false, problems: ["sms_dispatch_stale", "dead_letters"] } }]],
  });
  const problems = await checkOnce({ base: BASE, secret: "s3cret", fetchImpl });

  assert.deepEqual(problems, ["health: unhealthy (HTTP 503) — sms_dispatch_stale, dead_letters"]);
});

test("a 200 that says ok:false is still unhealthy", async () => {
  const { fetchImpl } = fakeFetch({
    ...structuredClone(healthy),
    "/api/v1/internal/health": [[200, { data: { ok: false, problems: ["outbox_backlog"] } }]],
  });
  const problems = await checkOnce({ base: BASE, secret: "s3cret", fetchImpl });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /outbox_backlog/);
});

test("a wrong secret is reported once, as a secret problem", async () => {
  const { fetchImpl } = fakeFetch({
    "/": [[200]],
    "/api/v1/internal/readiness": [[404, { error: { code: "not_found" } }]],
    "/api/v1/internal/health": [[404, { error: { code: "not_found" } }]],
  });
  const problems = await checkOnce({ base: BASE, secret: "wrong", fetchImpl });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /PRODUCTION_CRON_SECRET does not match/);
});

test("readiness problems are listed by subsystem", async () => {
  const { fetchImpl } = fakeFetch({
    ...structuredClone(healthy),
    "/api/v1/internal/readiness": [
      [503, { data: { ok: false, problems: [{ subsystem: "stripe", problem: "STRIPE_WEBHOOK_SECRET is missing" }] } }],
    ],
  });
  const problems = await checkOnce({ base: BASE, secret: "s3cret", fetchImpl });

  assert.deepEqual(problems, ["readiness: not ready (HTTP 503) — stripe: STRIPE_WEBHOOK_SECRET is missing"]);
});

test("without the secret only the homepage is checked, and the report says so", async () => {
  const { fetchImpl, calls } = fakeFetch({ "/": [[200]] });
  const result = await watch({ base: BASE, secret: "", fetchImpl, sleep: async () => {} });
  const report = formatReport({ base: BASE, result, at: "2026-10-07T00:00:00.000Z" });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((c) => c.path), ["/"]);
  assert.match(report, /Only the homepage was checked/);
});

test("the report never contains the secret", async () => {
  const { fetchImpl } = fakeFetch({ "/": [[500], [500]], "/api/v1/internal/readiness": [[404]], "/api/v1/internal/health": [[404]] });
  const result = await watch({ base: BASE, secret: "s3cret-value", fetchImpl, sleep: async () => {} });
  const report = formatReport({ base: BASE, result, at: "2026-10-07T00:00:00.000Z" });

  assert.equal(result.ok, false);
  assert.doesNotMatch(report, /s3cret-value/);
});
