import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    throw new Error("the texting gate must answer before any auth client is built");
  },
}));
// Nothing switched off may reach the database: every path below must refuse
// before it would need a client. The one exception sets `database.client` —
// the Connections worker, which still deletes expired data.
const database = vi.hoisted(() => ({
  client: null as null | { rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }> },
}));
vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => {
    if (!database.client) throw new Error("texting is off: nothing should reach the database");
    return database.client;
  },
}));
// A provider whose signature always checks out, and whose events must never
// be read while texting is off.
vi.mock("@/lib/server/integrations/adapters", () => ({
  getAdapter: (id: string) =>
    id === "square"
      ? {
          id: "square",
          verifyWebhook: () => true,
          parseWebhook: () => {
            throw new Error("texting is off: a Connections event must not be read");
          },
        }
      : undefined,
}));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession: vi.fn() } }),
}));

import { BillingPanel } from "@/features/dashboard/billing-panel";
import { TEXTING_OFF_MESSAGE, textingEnabled } from "@/lib/features";
import { createPackCheckoutSession } from "@/lib/server/billing-service";
import { ApiError } from "@/lib/server/errors";
import { processIntegrations } from "@/lib/server/integrations/sync-runner";
import { dispatchOnce } from "@/lib/server/sms/dispatch";
import {
  previewTextRequest,
  recordConsentAttestation,
  scheduleTextRequest,
} from "@/lib/server/sms/text-request-service";
import { POST as connectionsWebhook } from "@/app/api/v1/webhooks/integrations/[provider]/route";
import { textingGate } from "@/proxy";

/**
 * Texting ships switched off (lib/features.ts). What ReviewBoost sells first
 * is the Tag — tap, rate, Google — so until the owner turns texting on,
 * nothing anywhere may offer, sell or send a text. Every other suite runs as a
 * deployment that has switched it on (tests/setup.ts); this one switches it
 * off and checks each surface: the owner bar, the pages and their APIs, the
 * send path behind them, the send worker, the money, the readiness gate, and
 * the words on the website.
 */

const SWITCH = "NEXT_PUBLIC_TEXTING_ENABLED";

beforeAll(() => {
  // As in proxy-public-routes.test.ts: jsdom's Headers and Node's must be one class.
  globalThis.Headers = new NextRequest(new URL("https://reviewboost.fit/"))
    .headers.constructor as typeof Headers;
});

beforeEach(() => {
  vi.stubEnv(SWITCH, "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  database.client = null;
});

function request(pathname: string) {
  return new NextRequest(new URL(pathname, "https://reviewboost.fit"));
}

async function refusal(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("the switch", () => {
  it("is on only for the exact word true", () => {
    for (const value of ["false", "", "1", "TRUE", "True", "yes", "on", " true"]) {
      vi.stubEnv(SWITCH, value);
      expect(textingEnabled(), JSON.stringify(value)).toBe(false);
    }
    vi.stubEnv(SWITCH, "true");
    expect(textingEnabled()).toBe(true);
  });

  it("is off when the variable is not set at all", () => {
    const saved = process.env[SWITCH];
    delete process.env[SWITCH];
    try {
      expect(textingEnabled()).toBe(false);
    } finally {
      if (saved !== undefined) process.env[SWITCH] = saved;
    }
  });
});

describe("while texting is off", () => {
  it("shows owners Home, Feedback and Tags, with Settings on a computer", async () => {
    vi.resetModules();
    const { DESKTOP_NAV, MOBILE_NAV } = await import("@/features/dashboard/nav-items");

    expect(MOBILE_NAV.map((item) => item.href)).toEqual(["/home", "/feedback", "/stands"]);
    expect(DESKTOP_NAV.map((item) => item.href)).toEqual(["/home", "/feedback", "/stands", "/settings"]);
  });

  it("sends an owner who opens a texting page somewhere useful", () => {
    const cases: Array<[string, string]> = [
      ["/text-requests", "/home"],
      ["/text-requests/new?customer=1", "/home"],
      ["/settings/connections", "/settings"],
      ["/settings/connections/square/callback?code=abc", "/settings"],
    ];
    for (const [from, to] of cases) {
      const response = textingGate(request(from));
      expect(response, from).not.toBeNull();
      expect(response!.status, from).toBeGreaterThanOrEqual(300);
      expect(response!.status, from).toBeLessThan(400);
      const location = new URL(response!.headers.get("location") ?? "");
      expect(location.pathname, from).toBe(to);
      // The query belonged to the page that is gone; it does not follow.
      expect(location.search, from).toBe("");
    }
  });

  it("answers the texting APIs with not found, never cached", async () => {
    for (const pathname of [
      "/api/v1/text-requests",
      "/api/v1/text-requests/preview",
      "/api/v1/text-requests/consent",
      "/api/v1/customers/lists",
      "/api/v1/connections",
      "/api/v1/connections/providers/square/authorize",
    ]) {
      const response = textingGate(request(pathname));
      expect(response, pathname).not.toBeNull();
      expect(response!.status, pathname).toBe(404);
      expect(response!.headers.get("cache-control"), pathname).toBe("no-store");
      await expect(response!.json()).resolves.toEqual({
        error: { code: "not_found", message: TEXTING_OFF_MESSAGE },
      });
    }
  });

  it("leaves everything else alone, including the SMS webhook that records a STOP", () => {
    for (const pathname of [
      "/home",
      "/feedback",
      "/stands",
      "/settings",
      "/settings/billing",
      "/settings/connectionsx",
      "/text-requestsx",
      "/api/v1/home",
      "/api/v1/billing",
      "/api/v1/webhooks/sms/twilio",
      "/api/v1/webhooks/stripe",
      "/pricing",
    ]) {
      expect(textingGate(request(pathname)), pathname).toBeNull();
    }
  });

  it("refuses to preview, record consent for, or send a text even past the proxy", async () => {
    const context = {} as never;
    for (const call of [
      () => previewTextRequest(context, {} as never, "req_1"),
      () => recordConsentAttestation(context, {} as never, "req_1"),
      () => scheduleTextRequest(context, {} as never, "req_1"),
    ]) {
      const error = await refusal(call());
      expect(error.status).toBe(404);
      expect(error.message).toBe(TEXTING_OFF_MESSAGE);
    }
  });

  it("does not sell extra texts", async () => {
    const error = await refusal(createPackCheckoutSession({} as never, "org_1", "pack_50", "req_1"));
    expect(error.status).toBe(404);
    expect(error.message).toBe(TEXTING_OFF_MESSAGE);
  });

  it("lets the send worker claim nothing, so it needs no provider and stays healthy", async () => {
    // The mocked database throws if reached, so a resolved, empty summary
    // proves the worker returned before claiming or building a provider.
    await expect(dispatchOnce({ limit: 25 })).resolves.toEqual({
      claimed: 0,
      submitted: 0,
      suppressed: 0,
      failed: 0,
      unknown: 0,
      deferred: 0,
      skipped: 0,
    });
  });

  it("keeps Connections asleep, and still deletes expired customer data", async () => {
    const calls: string[] = [];
    database.client = {
      rpc: async (name: string) => {
        calls.push(name);
        return name === "rpc_integration_purge"
          ? { data: [{ profiles_deleted: 1, visits_deleted: 0, customers_deleted: 2 }], error: null }
          : { data: null, error: new Error(`${name} must not run while texting is off`) };
      },
    };

    const summary = await processIntegrations({ budgetMs: 5_000 });

    expect(calls).toEqual(["rpc_integration_purge"]);
    expect(summary).toMatchObject({ reconcilesQueued: 0, inboxProcessed: 0, runsFinished: 0 });
    expect(summary.purged).toEqual({ profiles: 1, visits: 0, customers: 2 });
  });

  it("acknowledges a signed Connections webhook and keeps nothing from it", async () => {
    vi.stubEnv("PUBLIC_FRONTEND_URL", "https://reviewboost.fit");
    const response = await connectionsWebhook(
      new NextRequest(new URL("https://reviewboost.fit/api/v1/webhooks/integrations/square"), {
        method: "POST",
        body: JSON.stringify({ type: "customer.updated", data: { phone: "+15555550100" } }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ provider: "square" }) },
    );

    // 200, so the provider stops retrying; nothing was parsed or stored (the
    // stand-in database and parser both throw if touched).
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { received: true, duplicate: false, ignored: true },
    });
  });

  it("shows Billing without texts left, monthly texts or packs", () => {
    render(
      <BillingPanel
        billing={{
          planId: "starter",
          status: "active",
          cancelAtPeriodEnd: false,
          trialEndsAt: null,
          currentPeriodEnd: "2026-12-24T00:00:00Z",
          smsBalance: { monthly: 74, purchased: 0, total: 74 },
          usage: { locations: { used: 1, limit: 1 }, tags: { used: 2, limit: 3 } },
          // Even if the server said packs were for sale, the page sells none.
          packsAvailable: true,
        }}
        canManage
      />,
    );

    expect(screen.getByText("1 of 1 location")).toBeVisible();
    expect(screen.getByText("2 of 3 Tags")).toBeVisible();
    expect(screen.queryByText(/texts? left/i)).not.toBeInTheDocument();
    expect(screen.queryByText("74 of 150")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /texts for/i })).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/\btexts?\b/i);
  });
});

describe("a production deployment while texting is off", () => {
  // Ready in every way that does not involve texting: no SMS_PROVIDER, no
  // Twilio, no pack prices.
  const KEY_A = Buffer.alloc(32, 1).toString("base64");
  const KEY_B = Buffer.alloc(32, 2).toString("base64");
  const LIVE_KEY = ["sk", "live", "abc123"].join("_");
  const WITHOUT_TEXTING: Record<string, string> = {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    APP_ENV: "",
    PUBLIC_FRONTEND_URL: "https://reviewboost.fit",
    SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    CUSTOMER_NOTE_ENCRYPTION_KEY: KEY_A,
    TOKEN_DIGEST_KEY: KEY_B,
    TOKEN_DIGEST_KEY_VERSION: "2",
    TOKEN_DIGEST_KEY_PREVIOUS: "",
    STRIPE_SECRET_KEY: LIVE_KEY,
    STRIPE_WEBHOOK_SECRET: "whsec_abc123",
    STRIPE_PRICE_STARTER: "price_starter1",
    STRIPE_PRICE_GROWTH: "price_growth1",
    STRIPE_PRICE_PRO: "price_pro1",
    STRIPE_PRICE_SMS_PACK_50: "",
    STRIPE_PRICE_SMS_PACK_200: "",
    STRIPE_PRICE_SMS_PACK_500: "",
    SMS_PROVIDER: "",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_MESSAGING_SERVICE_SID: "",
    CRON_SECRET: "c".repeat(40),
  };

  async function gate(texting: "true" | "false") {
    for (const [name, value] of Object.entries(WITHOUT_TEXTING)) vi.stubEnv(name, value);
    vi.stubEnv(SWITCH, texting);
    vi.resetModules();
    const { checkConfiguration } = await import("@/lib/server/readiness");
    return checkConfiguration();
  }

  it("is ready without Twilio or pack prices", async () => {
    const report = await gate("false");
    expect(report.problems).toEqual([]);
    expect(report).toMatchObject({ ok: true, tier: "production" });
  });

  it("needs both the moment texting is switched on", async () => {
    const report = await gate("true");
    const problems = report.problems.map((p) => p.problem).join("\n");
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.subsystem === "sms")).toBe(true);
    for (const pack of ["PACK_50", "PACK_200", "PACK_500"]) {
      expect(problems).toContain(`STRIPE_PRICE_SMS_${pack}`);
    }
  });
});

describe("the website while texting is off", () => {
  async function publicWords(): Promise<string> {
    vi.resetModules();
    const [copy, faq, plans] = await Promise.all([
      import("@/features/public/public-copy"),
      import("@/features/public/faq"),
      import("@/features/public/pricing-plans"),
    ]);
    return JSON.stringify([copy, faq.FAQ, plans.EVERY_PLAN]);
  }

  it("does not offer, price or promise texts", async () => {
    const words = await publicWords();
    expect(words).not.toMatch(/Text Requests?/);
    expect(words).not.toMatch(/\btexts?\b/i);
    expect(words).not.toMatch(/\bby text\b/i);
  });

  it("does, once texting is switched on — the same lists, nothing hard-coded", async () => {
    vi.stubEnv(SWITCH, "true");
    const words = await publicWords();
    expect(words).toMatch(/Text Requests/);
  });

  it("tells the iPhone app, which hides its Texts tab from the same answer", () => {
    const home = readFileSync(path.join(process.cwd(), "app/api/v1/home/route.ts"), "utf8");
    expect(home).toMatch(/features:\s*\{\s*texting:\s*textingEnabled\(\)\s*\}/);
  });
});
