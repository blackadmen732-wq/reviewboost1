import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * App Review's sign-in, as behaviour.
 *
 * The properties that matter: it is off unless configured, it signs in exactly
 * one account, a wrong address and a wrong code are indistinguishable, the
 * limiter failing means "no", and the caller's IP address is never what is
 * stored.
 */

const rpcCalls: { bucket: string; key: string }[] = [];
let limiter: "allow" | "deny" | "error" = "allow";
const generateLink = vi.fn<
  (args: { type: string; email: string }) => Promise<{
    data: { properties: { hashed_token: string } };
    error: null | { message: string };
  }>
>(async () => ({
  data: { properties: { hashed_token: "one-time-hash" } },
  error: null,
}));

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({
    rpc: async (_name: string, args: { p_bucket: string; p_bucket_key: string }) => {
      rpcCalls.push({ bucket: args.p_bucket, key: args.p_bucket_key });
      if (limiter === "error") return { data: null, error: { message: "down" } };
      return { data: [{ allowed: limiter === "allow", retry_after_seconds: 0 }], error: null };
    },
    auth: { admin: { generateLink } },
  }),
}));

import { POST } from "@/app/api/v1/public/review-sign-in/route";

const ENV = ["REVIEW_SIGN_IN_EMAIL", "REVIEW_SIGN_IN_CODE", "TOKEN_DIGEST_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function request(body: unknown, address = "203.0.113.7") {
  return new Request("https://reviewboost.fit/api/v1/public/review-sign-in", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": address },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  for (const key of ENV) saved[key] = process.env[key];
  process.env.REVIEW_SIGN_IN_EMAIL = "App-Review@ReviewBoost.fit";
  process.env.REVIEW_SIGN_IN_CODE = "482913";
  process.env.TOKEN_DIGEST_KEY = Buffer.alloc(32, 7).toString("base64");
  rpcCalls.length = 0;
  limiter = "allow";
  generateLink.mockClear();
});

afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("POST /api/v1/public/review-sign-in", () => {
  it("does not exist unless it is configured", async () => {
    delete process.env.REVIEW_SIGN_IN_EMAIL;
    delete process.env.REVIEW_SIGN_IN_CODE;
    const res = await POST(request({ email: "app-review@reviewboost.fit", code: "482913" }));
    expect(res.status).toBe(404);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("treats a half-configured or weak code as off", async () => {
    process.env.REVIEW_SIGN_IN_CODE = "1234";
    const res = await POST(request({ email: "app-review@reviewboost.fit", code: "123456" }));
    expect(res.status).toBe(404);
  });

  it("signs in the configured account with the configured code", async () => {
    const res = await POST(request({ email: " app-review@reviewboost.fit ", code: "482913" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { tokenHash: string } };
    expect(body.data.tokenHash).toBe("one-time-hash");
    // The server's address, never the caller's spelling of it.
    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "app-review@reviewboost.fit",
    });
  });

  it("answers a wrong code and a different address identically", async () => {
    const wrongCode = await POST(request({ email: "app-review@reviewboost.fit", code: "000000" }));
    const wrongEmail = await POST(request({ email: "someone@example.com", code: "482913" }));
    expect(wrongCode.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    const a = (await wrongCode.json()) as { error: unknown };
    const b = (await wrongEmail.json()) as { error: unknown };
    expect(a.error).toEqual(b.error);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("refuses when the limiter says no, and when it cannot answer", async () => {
    limiter = "deny";
    expect((await POST(request({ email: "app-review@reviewboost.fit", code: "482913" }))).status).toBe(429);
    limiter = "error";
    expect((await POST(request({ email: "app-review@reviewboost.fit", code: "482913" }))).status).toBe(429);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("limits per client and overall, and never stores the address", async () => {
    await POST(request({ email: "app-review@reviewboost.fit", code: "000000" }, "198.51.100.4"));
    const buckets = rpcCalls.map((call) => call.bucket);
    expect(buckets).toEqual(["review-sign-in-client", "review-sign-in-all"]);
    for (const call of rpcCalls) expect(call.key).not.toContain("198.51.100.4");
  });

  it("rejects a code that is not six digits before touching anything", async () => {
    const res = await POST(request({ email: "app-review@reviewboost.fit", code: "48291" }));
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});
