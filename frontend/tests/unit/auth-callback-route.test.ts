import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The Apple/Google return route.
 *
 * What matters: a good code becomes a session and lands on the requested page;
 * every other outcome lands on /login with a reason; and `next` can never send
 * the owner off-site even though it travelled through a third party.
 */

let exchange: (code: string) => Promise<{ error: { message: string } | null }> = async () => ({
  error: null,
});
const exchanged: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: {
      exchangeCodeForSession: async (code: string) => {
        exchanged.push(code);
        return exchange(code);
      },
    },
  }),
}));

vi.mock("@/lib/server/env", () => ({ publicFrontendUrl: () => "https://reviewboost.fit" }));
vi.mock("@/lib/server/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";

function call(query: string) {
  return GET(new NextRequest(`https://reviewboost.fit/auth/callback?${query}`));
}

beforeEach(() => {
  exchanged.length = 0;
  exchange = async () => ({ error: null });
});

describe("GET /auth/callback", () => {
  it("exchanges the code and continues to the requested page", async () => {
    const res = await call("code=abc&next=%2Fcustomer-page");
    expect(exchanged).toEqual(["abc"]);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://reviewboost.fit/customer-page");
  });

  it("goes Home when no destination was given", async () => {
    const res = await call("code=abc");
    expect(res.headers.get("location")).toBe("https://reviewboost.fit/home");
  });

  it("never follows a destination off-site", async () => {
    const res = await call("code=abc&next=https%3A%2F%2Fevil.example%2Fsteal");
    expect(res.headers.get("location")).toBe("https://reviewboost.fit/home");
    const res2 = await call("code=abc&next=%2F%2Fevil.example");
    expect(res2.headers.get("location")).toBe("https://reviewboost.fit/home");
  });

  it("treats a closed Apple or Google sheet as cancelled, without a session", async () => {
    const res = await call("error=access_denied&error_description=user+cancelled&next=%2Fonboarding");
    expect(exchanged).toEqual([]);
    expect(res.headers.get("location")).toBe(
      "https://reviewboost.fit/login?error=cancelled&next=%2Fonboarding",
    );
  });

  it("reports other provider errors as failed", async () => {
    const res = await call("error=server_error");
    expect(res.headers.get("location")).toBe("https://reviewboost.fit/login?error=failed");
  });

  it("reports a missing code as failed", async () => {
    const res = await call("next=%2Fhome");
    expect(res.headers.get("location")).toBe("https://reviewboost.fit/login?error=failed");
  });

  it("reports a used or expired code as expired", async () => {
    exchange = async () => ({ error: { message: "invalid flow state, no valid flow state found" } });
    const res = await call("code=old");
    expect(res.headers.get("location")).toBe("https://reviewboost.fit/login?error=expired");
  });

  it("reports an exchange that throws as failed", async () => {
    exchange = async () => {
      throw new Error("network");
    };
    const res = await call("code=abc");
    expect(res.headers.get("location")).toBe("https://reviewboost.fit/login?error=failed");
  });
});
