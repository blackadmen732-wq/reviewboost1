import "server-only";

import {
  deploymentTier,
  encryptionKey,
  publicFrontendUrl,
  stripePriceId,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  supabaseUrl,
  tokenDigestKey,
  tokenDigestKeyVersion,
  previousTokenDigestKey,
  type DeploymentTier,
} from "@/lib/server/env";
import { EXPECTED_MIGRATIONS } from "@/lib/server/schema-manifest";
import { getProviderRate, getSmsProvider } from "@/lib/server/sms/provider";

/**
 * The production readiness gate.
 *
 * `next build` deliberately needs no secrets (every accessor in env.ts is
 * lazy), which means a deployment can build, go live, and discover on the
 * first customer request that it cannot verify a webhook or send a message.
 * This is the check that runs *before* traffic: the release procedure calls
 * `/api/v1/internal/readiness` on the candidate deployment and refuses to
 * promote it unless `ok` is true.
 *
 * Every problem names the variable or resource to fix and never its value.
 */

export type Subsystem = "core" | "keys" | "stripe" | "sms" | "workers" | "database" | "storage";

export interface ReadinessProblem {
  subsystem: Subsystem;
  problem: string;
}

export interface ReadinessReport {
  ok: boolean;
  tier: DeploymentTier | "invalid";
  problems: ReadinessProblem[];
}

function attempt(subsystem: Subsystem, problems: ReadinessProblem[], check: () => unknown): void {
  try {
    check();
  } catch (error) {
    problems.push({
      subsystem,
      problem: error instanceof Error ? error.message : "unknown configuration error",
    });
  }
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

const PLANS = ["starter", "growth", "pro"] as const;

/** Configuration only: no network. Safe to run anywhere, any time. */
export function checkConfiguration(): ReadinessReport {
  const problems: ReadinessProblem[] = [];

  let tier: DeploymentTier;
  try {
    tier = deploymentTier();
  } catch (error) {
    return {
      ok: false,
      tier: "invalid",
      problems: [{ subsystem: "core", problem: error instanceof Error ? error.message : "invalid tier" }],
    };
  }
  const strict = tier === "production";
  const hosted = tier === "production" || tier === "staging";

  // ------------------------------------------------------------ core ----
  attempt("core", problems, publicFrontendUrl);
  if (hosted) {
    attempt("core", problems, () => {
      const url = new URL(publicFrontendUrl());
      if (url.protocol !== "https:") throw new Error("PUBLIC_FRONTEND_URL must be https");
      if (strict && /\.vercel\.app$/i.test(url.hostname)) {
        // A Tag is printed with this origin. A *.vercel.app origin is not one
        // the business controls, and cannot be moved later.
        throw new Error("PUBLIC_FRONTEND_URL must be the product's own domain, not *.vercel.app");
      }
    });
  }
  attempt("core", problems, () => {
    const url = new URL(supabaseUrl());
    if (hosted && url.protocol !== "https:") throw new Error("SUPABASE_URL must be https");
  });
  attempt("core", problems, supabaseAnonKey);
  attempt("core", problems, supabaseServiceRoleKey);
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    if (!env(name)) problems.push({ subsystem: "core", problem: `${name} is required (browser sign-in)` });
  }
  if (env("NEXT_PUBLIC_SUPABASE_URL") && env("SUPABASE_URL") && env("NEXT_PUBLIC_SUPABASE_URL") !== env("SUPABASE_URL")) {
    problems.push({ subsystem: "core", problem: "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL point at different projects" });
  }

  // ------------------------------------------------------------ keys ----
  attempt("keys", problems, encryptionKey);
  attempt("keys", problems, tokenDigestKey);
  attempt("keys", problems, tokenDigestKeyVersion);
  attempt("keys", problems, previousTokenDigestKey);
  if (strict) {
    attempt("keys", problems, () => {
      const previous = previousTokenDigestKey();
      if (previous && previous.equals(tokenDigestKey())) {
        throw new Error("TOKEN_DIGEST_KEY_PREVIOUS must differ from TOKEN_DIGEST_KEY");
      }
    });
  }

  // ---------------------------------------------------------- stripe ----
  if (hosted || env("STRIPE_SECRET_KEY")) {
    const secret = env("STRIPE_SECRET_KEY");
    const live = /^(sk|rk)_live_/.test(secret);
    const test = /^(sk|rk)_test_/.test(secret);
    if (!live && !test) {
      problems.push({ subsystem: "stripe", problem: "STRIPE_SECRET_KEY is missing or not a Stripe secret/restricted key" });
    } else if (strict && !live) {
      problems.push({ subsystem: "stripe", problem: "STRIPE_SECRET_KEY must be a live-mode key in production" });
    } else if (!strict && live) {
      // A preview or staging deployment holding a live key can charge a real card.
      problems.push({ subsystem: "stripe", problem: `STRIPE_SECRET_KEY must be a test-mode key on ${tier}` });
    }
    if (!/^whsec_[A-Za-z0-9]+$/.test(env("STRIPE_WEBHOOK_SECRET"))) {
      problems.push({ subsystem: "stripe", problem: "STRIPE_WEBHOOK_SECRET is missing or not a whsec_ secret" });
    }
    const prices = new Set<string>();
    for (const plan of PLANS) {
      attempt("stripe", problems, () => {
        const price = stripePriceId(plan);
        if (!/^price_[A-Za-z0-9_]+$/.test(price)) {
          throw new Error(`STRIPE_PRICE_${plan.toUpperCase()} is not a Stripe price id`);
        }
        if (prices.has(price)) throw new Error(`STRIPE_PRICE_${plan.toUpperCase()} repeats another plan's price`);
        prices.add(price);
      });
    }
  }

  // ------------------------------------------------------------- sms ----
  attempt("sms", problems, getSmsProvider);
  attempt("sms", problems, getProviderRate);
  if (strict) {
    attempt("sms", problems, () => {
      if (getProviderRate().perSegmentMicros <= 0) {
        throw new Error("SMS_RATE_PER_SEGMENT_MICROS must be greater than zero in production");
      }
    });
  }
  const country = env("SMS_DEFAULT_COUNTRY_CALLING_CODE");
  if (country && !/^\+?[1-9][0-9]{0,3}$/.test(country)) {
    problems.push({ subsystem: "sms", problem: "SMS_DEFAULT_COUNTRY_CALLING_CODE must be a calling code like 1 or 44" });
  }

  // --------------------------------------------------------- workers ----
  if (hosted) {
    const secrets = [env("CRON_SECRET"), env("SMS_WORKER_SECRET")].filter(Boolean);
    if (secrets.length === 0) {
      problems.push({ subsystem: "workers", problem: "CRON_SECRET (or SMS_WORKER_SECRET) is required: no scheduler can run the workers" });
    } else if (secrets.some((secret) => secret.length < 32)) {
      problems.push({ subsystem: "workers", problem: "worker secrets must be at least 32 characters" });
    }
  }

  return { ok: problems.length === 0, tier, problems };
}

/**
 * What only the running infrastructure can answer. Injected so it can be
 * tested without a database; in production it is the service-role client.
 */
export interface LiveProbe {
  priceCatalog(): Promise<Array<{ stripe_price_id: string; plan_id: string }>>;
  bucket(name: string): Promise<{ exists: boolean; public: boolean }>;
  smsHealth(): Promise<boolean>;
  appliedMigrations(): Promise<string[]>;
}

export async function checkLive(probe: LiveProbe, report: ReadinessReport): Promise<ReadinessReport> {
  const problems = [...report.problems];

  // rpc_billing_price_catalog exists only from migration 20260924000100, so
  // reaching it proves the database is at (or past) the schema this build
  // expects. A build must never be promoted onto an older database.
  try {
    const catalog = await probe.priceCatalog();
    const mapped = new Map(catalog.map((row) => [row.stripe_price_id, row.plan_id]));
    if (report.tier === "production" || report.tier === "staging") {
      for (const plan of PLANS) {
        let price: string;
        try {
          price = stripePriceId(plan);
        } catch {
          continue; // already reported by the configuration check
        }
        const dbPlan = mapped.get(price);
        if (!dbPlan) {
          problems.push({
            subsystem: "database",
            problem: `STRIPE_PRICE_${plan.toUpperCase()} is not in billing_plan_prices: its subscriptions would grant nothing`,
          });
        } else if (dbPlan !== plan) {
          problems.push({
            subsystem: "database",
            problem: `billing_plan_prices maps STRIPE_PRICE_${plan.toUpperCase()} to ${dbPlan}, not ${plan}`,
          });
        }
      }
    }
  } catch {
    problems.push({
      subsystem: "database",
      problem: "cannot read rpc_billing_price_catalog: the database is unreachable or behind this build's migrations",
    });
  }

  // Every migration this build was written against must already be applied.
  // This is the mechanical form of "the database moves first".
  try {
    const applied = new Set(await probe.appliedMigrations());
    const missing = EXPECTED_MIGRATIONS.filter((name) => !applied.has(name));
    if (missing.length > 0) {
      problems.push({
        subsystem: "database",
        problem: `database is missing ${missing.length} migration(s) this build requires: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}`,
      });
    }
  } catch {
    problems.push({ subsystem: "database", problem: "cannot read the migration ledger (rpc_applied_migrations)" });
  }

  try {
    if (!(await probe.smsHealth())) {
      problems.push({ subsystem: "database", problem: "rpc_sms_health failed" });
    }
  } catch {
    problems.push({ subsystem: "database", problem: "rpc_sms_health failed" });
  }

  try {
    const bucket = await probe.bucket("customer-page");
    if (!bucket.exists) {
      problems.push({ subsystem: "storage", problem: "Storage bucket customer-page does not exist" });
    } else if (!bucket.public) {
      // Published Customer Pages link assets by public URL.
      problems.push({ subsystem: "storage", problem: "Storage bucket customer-page must be public-read" });
    }
  } catch {
    problems.push({ subsystem: "storage", problem: "Storage is unreachable" });
  }

  return { ok: problems.length === 0, tier: report.tier, problems };
}
