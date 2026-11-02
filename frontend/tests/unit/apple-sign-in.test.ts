import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Sign in with Apple: which buttons show, and the token kept only to revoke.
 *
 * Apple requires an app that offers Sign in with Apple to revoke the person's
 * tokens when they delete their account. These tests pin the three things
 * that make that true: the client secret is a JWT Apple will accept, the
 * token is stored encrypted, and deletion presents it to Apple's revoke
 * endpoint (and never fails the deletion when Apple does not answer).
 */

const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let takeRows: unknown[] = [];

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "rpc_apple_sign_in_token_take") return Promise.resolve({ data: takeRows, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const fetchMock = vi.fn();

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
});

beforeEach(() => {
  rpcCalls.length = 0;
  takeRows = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.APPLE_TEAM_ID = "TEAM123456";
  process.env.APPLE_SIGN_IN_KEY_ID = "KEY1234567";
  // Stored in Vercel with "\n" escapes; the module turns them back.
  process.env.APPLE_SIGN_IN_PRIVATE_KEY = PEM.replace(/\n/g, "\\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function formOf(call: unknown[]): URLSearchParams {
  return new URLSearchParams((call[1] as { body: string }).body);
}

describe("which sign-in buttons show", () => {
  it("shows only providers that are listed", async () => {
    const { parseSignInProviders } = await import("@/lib/auth/sign-in-providers");
    expect(parseSignInProviders(undefined)).toEqual([]);
    expect(parseSignInProviders("")).toEqual([]);
    expect(parseSignInProviders("apple")).toEqual(["apple"]);
    expect(parseSignInProviders(" Apple , GOOGLE ")).toEqual(["apple", "google"]);
    expect(parseSignInProviders("google,apple,facebook")).toEqual(["apple", "google"]);
  });

  it("never shows Google without Apple (App Store Guideline 4.8)", async () => {
    const { parseSignInProviders } = await import("@/lib/auth/sign-in-providers");
    expect(parseSignInProviders("google")).toEqual([]);
  });
});

describe("the client secret", () => {
  it("is an ES256 JWT for Apple, signed with the Sign in with Apple key", async () => {
    const { appleClientSecret } = await import("@/lib/server/apple-sign-in");
    const secret = appleClientSecret(
      "fit.reviewboost.app",
      { teamId: "TEAM123456", keyId: "KEY1234567", privateKey: PEM },
      Date.UTC(2026, 10, 2),
    );
    const [header, payload, signature] = secret.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY1234567",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: "TEAM123456",
      aud: "https://appleid.apple.com",
      sub: "fit.reviewboost.app",
    });
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(15_777_000);
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: createPublicKey(publicKey.export({ type: "spki", format: "pem" })), dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("keeping the token", () => {
  it("exchanges the iPhone app's code and stores the refresh token encrypted", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ refresh_token: "apple-refresh-1" }), { status: 200 }));
    const { keepAppleTokenFromCode } = await import("@/lib/server/apple-sign-in");
    const { decrypt } = await import("@/lib/server/crypto");

    const kept = await keepAppleTokenFromCode("user-1", "one-time-code-123", "fit.reviewboost.app", "req-1");

    expect(kept).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://appleid.apple.com/auth/token");
    const form = formOf(fetchMock.mock.calls[0]!);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("one-time-code-123");
    expect(form.get("client_id")).toBe("fit.reviewboost.app");

    const store = rpcCalls.find((call) => call.name === "rpc_apple_sign_in_token_store")!;
    expect(store.args.p_user_id).toBe("user-1");
    expect(store.args.p_refresh_token_enc).not.toContain("apple-refresh-1");
    expect(decrypt(store.args.p_refresh_token_enc as string)).toBe("apple-refresh-1");
  });

  it("keeps nothing, and never throws, when Apple is not set up", async () => {
    delete process.env.APPLE_SIGN_IN_PRIVATE_KEY;
    const { keepAppleTokenFromCode } = await import("@/lib/server/apple-sign-in");
    await expect(keepAppleTokenFromCode("user-1", "one-time-code-123", "fit.reviewboost.app", "req-1")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("revoking at account deletion", () => {
  it("presents the stored token to Apple's revoke endpoint", async () => {
    const { encrypt } = await import("@/lib/server/crypto");
    takeRows = [{ client_id: "fit.reviewboost.app", refresh_token_enc: encrypt("apple-refresh-1") }];
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { revokeAppleSignIn } = await import("@/lib/server/apple-sign-in");

    await expect(revokeAppleSignIn("user-1", "req-1")).resolves.toBe("revoked");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://appleid.apple.com/auth/revoke");
    const form = formOf(fetchMock.mock.calls[0]!);
    expect(form.get("token")).toBe("apple-refresh-1");
    expect(form.get("token_type_hint")).toBe("refresh_token");
    expect(form.get("client_id")).toBe("fit.reviewboost.app");
  });

  it("does nothing for someone who never used Sign in with Apple", async () => {
    const { revokeAppleSignIn } = await import("@/lib/server/apple-sign-in");
    await expect(revokeAppleSignIn("user-1", "req-1")).resolves.toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a failure without throwing when Apple refuses", async () => {
    const { encrypt } = await import("@/lib/server/crypto");
    takeRows = [{ client_id: "fit.reviewboost.app", refresh_token_enc: encrypt("apple-refresh-1") }];
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    const { revokeAppleSignIn } = await import("@/lib/server/apple-sign-in");
    await expect(revokeAppleSignIn("user-1", "req-1")).resolves.toBe("failed");
  });
});
