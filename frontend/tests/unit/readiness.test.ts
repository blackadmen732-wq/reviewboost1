import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The production gate, case by case.
 *
 * Every test starts from a configuration that is fully ready for paying
 * customers and breaks exactly one thing, so a passing "refuses" test cannot
 * be passing for some other reason.
 */

// Assembled so the repository's committed-credential scanners (which match
// the live-key prefix literally) do not flag a fixture that is not a key.
const LIVE_KEY = ["sk", "live", "abc123"].join("_");

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const KEY_C = Buffer.alloc(32, 3).toString("base64");

const READY: Record<string, string> = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  APP_ENV: "",
  PUBLIC_FRONTEND_URL: "https://reviewboost.fit",
  SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "",
  CUSTOMER_NOTE_ENCRYPTION_KEY: KEY_A,
  TOKEN_DIGEST_KEY: KEY_B,
  TOKEN_DIGEST_KEY_VERSION: "2",
  TOKEN_DIGEST_KEY_PREVIOUS: "",
  STRIPE_SECRET_KEY: LIVE_KEY,
  STRIPE_WEBHOOK_SECRET: "whsec_abc123",
  STRIPE_PRICE_STARTER: "price_starter1",
  STRIPE_PRICE_GROWTH: "price_growth1",
  STRIPE_PRICE_PRO: "price_pro1",
  SMS_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "t".repeat(32),
  TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
  TWILIO_FROM_NUMBER: "",
  SMS_PUBLIC_WEBHOOK_BASE_URL: "https://reviewboost.fit",
  SMS_RATE_PER_SEGMENT_MICROS: "7900",
  SMS_RATE_CURRENCY: "USD",
  SMS_DEFAULT_COUNTRY_CALLING_CODE: "1",
  CRON_SECRET: "c".repeat(40),
  SMS_WORKER_SECRET: "",
};

function configure(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...READY, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

async function gate() {
  const { checkConfiguration } = await import("@/lib/server/readiness");
  return checkConfiguration();
}

function problemsOf(report: { problems: Array<{ problem: string }> }): string {
  return report.problems.map((p) => p.problem).join("\n");
}

beforeEach(() => {
  vi.resetModules();
  configure();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a fully configured production deployment", () => {
  it("passes the gate", async () => {
    const report = await gate();
    expect(problemsOf(report)).toBe("");
    expect(report).toMatchObject({ ok: true, tier: "production" });
  });
});

describe("the deployment tier", () => {
  it("is production on Vercel production", async () => {
    const { deploymentTier } = await import("@/lib/server/env");
    expect(deploymentTier()).toBe("production");
  });

  it("is preview on a Vercel preview, even though NODE_ENV is production there", async () => {
    configure({ VERCEL_ENV: "preview" });
    const { deploymentTier } = await import("@/lib/server/env");
    expect(deploymentTier()).toBe("preview");
  });

  it("is production for a production build on an unknown host — the strict default", async () => {
    configure({ VERCEL_ENV: "" });
    const { deploymentTier } = await import("@/lib/server/env");
    expect(deploymentTier()).toBe("production");
  });

  it("cannot be relaxed to preview on Vercel production by a stray APP_ENV", async () => {
    configure({ APP_ENV: "preview" });
    const report = await gate();
    expect(report.ok).toBe(false);
    expect(report.tier).toBe("invalid");
  });

  it("may be narrowed to staging on a staging project's production target", async () => {
    configure({ APP_ENV: "staging", STRIPE_SECRET_KEY: "sk_test_abc" });
    const { deploymentTier } = await import("@/lib/server/env");
    expect(deploymentTier()).toBe("staging");
  });
});

describe("key separation", () => {
  it("refuses production with no TOKEN_DIGEST_KEY (no fallback to the encryption key)", async () => {
    configure({ TOKEN_DIGEST_KEY: "" });
    const report = await gate();
    expect(report.ok).toBe(false);
    expect(problemsOf(report)).toMatch(/TOKEN_DIGEST_KEY is required in production/);
  });

  it("refuses the actual digest call too, not just the gate", async () => {
    configure({ TOKEN_DIGEST_KEY: "" });
    const { tokenDigestKey } = await import("@/lib/server/env");
    expect(() => tokenDigestKey()).toThrow(/required in production/);
  });

  it("refuses production when the digest key is the encryption key", async () => {
    configure({ TOKEN_DIGEST_KEY: KEY_A });
    expect(problemsOf(await gate())).toMatch(/must differ from CUSTOMER_NOTE_ENCRYPTION_KEY/);
  });

  it("refuses a digest key that is not 32 bytes", async () => {
    configure({ TOKEN_DIGEST_KEY: Buffer.alloc(16, 9).toString("base64") });
    expect(problemsOf(await gate())).toMatch(/TOKEN_DIGEST_KEY must be a base64-encoded 32-byte key/);
  });

  it("refuses an encryption key that is not 32 bytes", async () => {
    configure({ CUSTOMER_NOTE_ENCRYPTION_KEY: "c2hvcnQ=" });
    expect(problemsOf(await gate())).toMatch(/CUSTOMER_NOTE_ENCRYPTION_KEY must be a base64-encoded 32-byte key/);
  });

  it("requires an explicit key version in production", async () => {
    configure({ TOKEN_DIGEST_KEY_VERSION: "" });
    expect(problemsOf(await gate())).toMatch(/TOKEN_DIGEST_KEY_VERSION is required in production/);
  });

  it("allows moving off the old fallback by rotation: previous = the encryption key", async () => {
    configure({ TOKEN_DIGEST_KEY_PREVIOUS: KEY_A, TOKEN_DIGEST_KEY: KEY_C });
    expect((await gate()).ok).toBe(true);
  });

  it("still allows the fallback in development", async () => {
    configure({ VERCEL_ENV: "", NODE_ENV: "development", TOKEN_DIGEST_KEY: "" });
    const { tokenDigestKey, encryptionKey } = await import("@/lib/server/env");
    expect(tokenDigestKey().equals(encryptionKey())).toBe(true);
  });
});

describe("no fake SMS for paying customers", () => {
  it("refuses SMS_PROVIDER=fake in production", async () => {
    configure({ SMS_PROVIDER: "fake" });
    expect(problemsOf(await gate())).toMatch(/SMS_PROVIDER must be twilio in production/);
  });

  it("refuses an unset provider in production", async () => {
    configure({ SMS_PROVIDER: "" });
    const { getSmsProvider } = await import("@/lib/server/sms/provider");
    expect(() => getSmsProvider()).toThrow(/must be twilio in production/);
  });

  it("refuses Twilio with no sending identity", async () => {
    configure({ TWILIO_MESSAGING_SERVICE_SID: "", TWILIO_FROM_NUMBER: "" });
    expect(problemsOf(await gate())).toMatch(/sending identity is required/);
  });

  it("refuses Twilio with a malformed account SID", async () => {
    configure({ TWILIO_ACCOUNT_SID: "ACnope" });
    expect(problemsOf(await gate())).toMatch(/TWILIO_ACCOUNT_SID/);
  });

  it("refuses Twilio without a status-callback URL", async () => {
    configure({ SMS_PUBLIC_WEBHOOK_BASE_URL: "" });
    expect(problemsOf(await gate())).toMatch(/SMS_PUBLIC_WEBHOOK_BASE_URL/);
  });

  it("refuses production without a segment price", async () => {
    configure({ SMS_RATE_PER_SEGMENT_MICROS: "" });
    expect(problemsOf(await gate())).toMatch(/SMS_RATE_PER_SEGMENT_MICROS must be configured/);
  });

  it("refuses a zero segment price in production", async () => {
    configure({ SMS_RATE_PER_SEGMENT_MICROS: "0" });
    expect(problemsOf(await gate())).toMatch(/greater than zero/);
  });

  it("accepts a From number instead of a Messaging Service", async () => {
    configure({ TWILIO_MESSAGING_SERVICE_SID: "", TWILIO_FROM_NUMBER: "+15551234567" });
    expect((await gate()).ok).toBe(true);
  });

  it("never lets a preview send real SMS", async () => {
    configure({ VERCEL_ENV: "preview", STRIPE_SECRET_KEY: "sk_test_x" });
    const { getSmsProvider } = await import("@/lib/server/sms/provider");
    expect(() => getSmsProvider()).toThrow(/Previews never send real SMS/);
  });

  it("gives a preview the fake provider", async () => {
    configure({ VERCEL_ENV: "preview", SMS_PROVIDER: "fake", STRIPE_SECRET_KEY: "sk_test_x" });
    const { getSmsProvider } = await import("@/lib/server/sms/provider");
    expect(getSmsProvider().name).toBe("fake");
  });
});

describe("Stripe", () => {
  it("refuses a test-mode key in production", async () => {
    configure({ STRIPE_SECRET_KEY: "sk_test_abc" });
    expect(problemsOf(await gate())).toMatch(/live-mode key in production/);
  });

  it("refuses a live key on staging, where it could charge a real card", async () => {
    configure({ APP_ENV: "staging" });
    expect(problemsOf(await gate())).toMatch(/must be a test-mode key on staging/);
  });

  it("refuses a missing webhook secret", async () => {
    configure({ STRIPE_WEBHOOK_SECRET: "" });
    expect(problemsOf(await gate())).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });

  it("refuses a missing plan price", async () => {
    configure({ STRIPE_PRICE_PRO: "" });
    expect(problemsOf(await gate())).toMatch(/STRIPE_PRICE_PRO is required/);
  });

  it("refuses two plans sharing one price", async () => {
    configure({ STRIPE_PRICE_PRO: "price_starter1" });
    expect(problemsOf(await gate())).toMatch(/repeats another plan's price/);
  });
});

describe("core and workers", () => {
  it("refuses a *.vercel.app public origin in production — it is printed on Tags", async () => {
    configure({ PUBLIC_FRONTEND_URL: "https://reviewboost.vercel.app" });
    expect(problemsOf(await gate())).toMatch(/not \*\.vercel\.app/);
  });

  it("refuses a service-role key exposed as NEXT_PUBLIC_", async () => {
    configure({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "service" });
    expect(problemsOf(await gate())).toMatch(/must never be exposed as NEXT_PUBLIC_/);
  });

  it("refuses browser and server pointing at different Supabase projects", async () => {
    configure({ NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" });
    expect(problemsOf(await gate())).toMatch(/different projects/);
  });

  it("refuses production with no worker secret: nothing could ever send", async () => {
    configure({ CRON_SECRET: "" });
    expect(problemsOf(await gate())).toMatch(/CRON_SECRET/);
  });

  it("refuses a short worker secret", async () => {
    configure({ CRON_SECRET: "short" });
    expect(problemsOf(await gate())).toMatch(/at least 32 characters/);
  });

  it("never echoes a secret value into a problem", async () => {
    configure({ TOKEN_DIGEST_KEY: KEY_A, STRIPE_SECRET_KEY: "sk_test_SECRETVALUE" });
    const text = problemsOf(await gate());
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain("SECRETVALUE");
  });
});

describe("live checks", () => {
  const healthy = {
    priceCatalog: async () => [
      { stripe_price_id: "price_starter1", plan_id: "starter" },
      { stripe_price_id: "price_growth1", plan_id: "growth" },
      { stripe_price_id: "price_pro1", plan_id: "pro" },
    ],
    bucket: async () => ({ exists: true, public: true }),
    smsHealth: async () => true,
  };

  async function live(probe: Partial<typeof healthy>) {
    const { checkConfiguration, checkLive } = await import("@/lib/server/readiness");
    return checkLive({ ...healthy, ...probe }, checkConfiguration());
  }

  it("passes when the database maps exactly the configured prices", async () => {
    expect(await live({})).toMatchObject({ ok: true });
  });

  it("fails when a configured price is not mapped in the database", async () => {
    const report = await live({
      priceCatalog: async () => [{ stripe_price_id: "price_starter1", plan_id: "starter" }],
    });
    expect(problemsOf(report)).toMatch(/STRIPE_PRICE_GROWTH is not in billing_plan_prices/);
  });

  it("fails when the database maps a price to a different plan", async () => {
    const report = await live({
      priceCatalog: async () => [
        { stripe_price_id: "price_starter1", plan_id: "pro" },
        { stripe_price_id: "price_growth1", plan_id: "growth" },
        { stripe_price_id: "price_pro1", plan_id: "pro" },
      ],
    });
    expect(problemsOf(report)).toMatch(/maps STRIPE_PRICE_STARTER to pro/);
  });

  it("fails when the database is behind this build's migrations", async () => {
    const report = await live({
      priceCatalog: async () => {
        throw new Error("function does not exist");
      },
    });
    expect(problemsOf(report)).toMatch(/behind this build's migrations/);
  });

  it("fails when the Customer Page bucket is missing", async () => {
    expect(problemsOf(await live({ bucket: async () => ({ exists: false, public: false }) }))).toMatch(
      /bucket customer-page does not exist/,
    );
  });

  it("fails when the Customer Page bucket is private", async () => {
    expect(problemsOf(await live({ bucket: async () => ({ exists: true, public: false }) }))).toMatch(
      /must be public-read/,
    );
  });
});
