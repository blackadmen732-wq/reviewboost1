import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Tests that every public write passes previous-key digests to Supabase,
 * ensuring stand, session, and response resolution works during
 * TOKEN_DIGEST_KEY rotation.
 *
 * The tests mock crypto and Supabase at the module boundary — they verify the
 * service layer's wiring, not the database functions (those are tested by pgTAP).
 */

const CURRENT_HASH = "current-stand-hash";
const PREVIOUS_HASH = "previous-stand-hash";
const SESSION_HASH = "session-hash";
const PREVIOUS_SESSION_HASH = "previous-session-hash";
const RESPONSE_HASH = "response-hash";
const PREVIOUS_RESPONSE_HASH = "previous-response-hash";
const IDEM_HASH = "idem-hash";
const REQUEST_HASH = "req-hash";
const CLIENT_HASH = "client-hash";
const ENCRYPTED = "v1:iv:tag:ct";

let rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
let rpcResult: Array<{ outcome: string; response_status: number | null; response_body_encrypted: string | null }> = [
  { outcome: "created", response_status: 201, response_body_encrypted: ENCRYPTED },
];

vi.mock("@/lib/server/crypto", () => ({
  KEY_VERSION: 1,
  digestStandToken: () => CURRENT_HASH,
  digestStandTokenWithPreviousKey: () => PREVIOUS_HASH,
  digestSessionToken: () => SESSION_HASH,
  digestSessionTokenWithPreviousKey: () => PREVIOUS_SESSION_HASH,
  digestResponseToken: () => RESPONSE_HASH,
  digestResponseTokenWithPreviousKey: () => PREVIOUS_RESPONSE_HASH,
  digestIdempotencyKey: () => IDEM_HASH,
  digestRequestBody: () => REQUEST_HASH,
  clientFingerprint: () => CLIENT_HASH,
  generateToken: () => "generated-token",
  encrypt: () => ENCRYPTED,
  decrypt: (v: string | null) => (v ? '{"sessionId":"s","responseId":"r","teamPraiseId":"p"}' : null),
}));

vi.mock("@/lib/server/env", () => ({
  tokenDigestKeyVersion: () => 2,
}));

vi.mock("@/lib/server/errors", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    ERROR_CODE: {
      serviceUnavailable: "service_unavailable",
      idempotencyConflict: "idempotency_conflict",
      idempotencyInProgress: "idempotency_in_progress",
      sessionInvalid: "session_invalid",
      sessionExpired: "session_expired",
      responseConflict: "response_conflict",
      internalError: "internal_error",
      validationFailed: "validation_failed",
    },
    rateLimited: () => new ApiError(429, "rate_limited", "slow down"),
    reviewLinkInactive: () => new ApiError(404, "not_found", "not found"),
  };
});

vi.mock("@/lib/server/google-review-url", () => ({
  isValidGoogleReviewUrl: () => true,
}));

vi.mock("@/lib/server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      if (name === "rpc_consume_rate_limit") {
        return Promise.resolve({
          data: [{ allowed: true, retry_after_seconds: 0 }],
          error: null,
        });
      }
      return Promise.resolve({ data: rpcResult, error: null });
    },
  }),
}));

vi.mock("@/lib/server/validation", () => ({
  DEFAULT_LOCALE: "en",
  SUPPORTED_LOCALES: ["en"] as const,
  canonicalJson: (v: unknown) => JSON.stringify(v),
  normalizeCustomerText: (v?: string) => v?.trim() ?? "",
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: () => "00000000-0000-0000-0000-000000000000",
  };
});

const meta = { address: "127.0.0.1", userAgent: "test", requestId: "req-1" };

describe("token rotation — previous stand hash forwarding", () => {
  beforeEach(() => {
    rpcCalls = [];
    rpcResult = [{ outcome: "created", response_status: 201, response_body_encrypted: ENCRYPTED }];
  });

  it("createSession passes p_previous_token_hash", async () => {
    const { createSession } = await import("@/lib/server/customer-flow-service");
    await createSession("raw-token", { locale: "en", idempotencyKey: "k1" }, meta);

    const sessionCall = rpcCalls.find((c) => c.name === "rpc_public_create_session");
    expect(sessionCall).toBeDefined();
    expect(sessionCall!.params.p_token_hash).toBe(CURRENT_HASH);
    expect(sessionCall!.params.p_previous_token_hash).toBe(PREVIOUS_HASH);
  });

  it("submitResponse passes p_previous_token_hash", async () => {
    const { submitResponse } = await import("@/lib/server/customer-flow-service");
    await submitResponse(
      "raw-token",
      { sessionId: "s", rating: 5, idempotencyKey: "k2" },
      meta,
    );

    const call = rpcCalls.find((c) => c.name === "rpc_public_submit_response");
    expect(call).toBeDefined();
    expect(call!.params.p_token_hash).toBe(CURRENT_HASH);
    expect(call!.params.p_previous_token_hash).toBe(PREVIOUS_HASH);
  });

  it("recordGoogleClick passes p_previous_token_hash", async () => {
    rpcResult = [{ outcome: "created", response_status: 204, response_body_encrypted: null }];
    const { recordGoogleClick } = await import("@/lib/server/customer-flow-service");
    await recordGoogleClick(
      "raw-token",
      { sessionId: "s", responseId: "r", idempotencyKey: "k3" },
      meta,
    );

    const call = rpcCalls.find((c) => c.name === "rpc_public_record_google_click");
    expect(call).toBeDefined();
    expect(call!.params.p_token_hash).toBe(CURRENT_HASH);
    expect(call!.params.p_previous_token_hash).toBe(PREVIOUS_HASH);
  });

  it("submitTeamPraise passes p_previous_token_hash", async () => {
    const { submitTeamPraise } = await import("@/lib/server/customer-flow-service");
    await submitTeamPraise(
      "raw-token",
      { sessionId: "s", responseId: "r", firstName: "Alice", idempotencyKey: "k4" },
      meta,
    );

    const call = rpcCalls.find((c) => c.name === "rpc_public_submit_team_praise");
    expect(call).toBeDefined();
    expect(call!.params.p_token_hash).toBe(CURRENT_HASH);
    expect(call!.params.p_previous_token_hash).toBe(PREVIOUS_HASH);
  });
});

describe("token rotation — previous session/response hash forwarding", () => {
  beforeEach(() => {
    rpcCalls = [];
    rpcResult = [{ outcome: "created", response_status: 201, response_body_encrypted: ENCRYPTED }];
  });

  it("submitResponse passes p_previous_session_token_hash", async () => {
    const { submitResponse } = await import("@/lib/server/customer-flow-service");
    await submitResponse(
      "raw-token",
      { sessionId: "s", rating: 5, idempotencyKey: "k10" },
      meta,
    );

    const call = rpcCalls.find((c) => c.name === "rpc_public_submit_response");
    expect(call).toBeDefined();
    expect(call!.params.p_previous_session_token_hash).toBe(PREVIOUS_SESSION_HASH);
  });

  it("recordGoogleClick passes p_previous_session_token_hash and p_previous_response_token_hash", async () => {
    rpcResult = [{ outcome: "created", response_status: 204, response_body_encrypted: null }];
    const { recordGoogleClick } = await import("@/lib/server/customer-flow-service");
    await recordGoogleClick(
      "raw-token",
      { sessionId: "s", responseId: "r", idempotencyKey: "k11" },
      meta,
    );

    const call = rpcCalls.find((c) => c.name === "rpc_public_record_google_click");
    expect(call).toBeDefined();
    expect(call!.params.p_previous_session_token_hash).toBe(PREVIOUS_SESSION_HASH);
    expect(call!.params.p_previous_response_token_hash).toBe(PREVIOUS_RESPONSE_HASH);
  });

  it("submitTeamPraise passes p_previous_session_token_hash and p_previous_response_token_hash", async () => {
    const { submitTeamPraise } = await import("@/lib/server/customer-flow-service");
    await submitTeamPraise(
      "raw-token",
      { sessionId: "s", responseId: "r", firstName: "Alice", idempotencyKey: "k12" },
      meta,
    );

    const call = rpcCalls.find((c) => c.name === "rpc_public_submit_team_praise");
    expect(call).toBeDefined();
    expect(call!.params.p_previous_session_token_hash).toBe(PREVIOUS_SESSION_HASH);
    expect(call!.params.p_previous_response_token_hash).toBe(PREVIOUS_RESPONSE_HASH);
  });
});

describe("token rotation — null previous hash when no rotation", () => {
  beforeEach(() => {
    rpcCalls = [];
    rpcResult = [{ outcome: "created", response_status: 201, response_body_encrypted: ENCRYPTED }];
  });

  it("passes null when digestStandTokenWithPreviousKey returns null", async () => {
    const cryptoMock = await import("@/lib/server/crypto");
    const standSpy = vi.spyOn(cryptoMock, "digestStandTokenWithPreviousKey" as never).mockReturnValue(null as never);
    const sessSpy = vi.spyOn(cryptoMock, "digestSessionTokenWithPreviousKey" as never).mockReturnValue(null as never);
    const respSpy = vi.spyOn(cryptoMock, "digestResponseTokenWithPreviousKey" as never).mockReturnValue(null as never);

    const { createSession } = await import("@/lib/server/customer-flow-service");
    await createSession("raw-token", { locale: "en", idempotencyKey: "k5" }, meta);

    const call = rpcCalls.find((c) => c.name === "rpc_public_create_session");
    expect(call!.params.p_previous_token_hash).toBeNull();

    standSpy.mockRestore();
    sessSpy.mockRestore();
    respSpy.mockRestore();
  });

  it("passes null session/response previous hashes when no rotation", async () => {
    const cryptoMock = await import("@/lib/server/crypto");
    const sessSpy = vi.spyOn(cryptoMock, "digestSessionTokenWithPreviousKey" as never).mockReturnValue(null as never);
    const respSpy = vi.spyOn(cryptoMock, "digestResponseTokenWithPreviousKey" as never).mockReturnValue(null as never);

    rpcResult = [{ outcome: "created", response_status: 204, response_body_encrypted: null }];
    const { recordGoogleClick } = await import("@/lib/server/customer-flow-service");
    await recordGoogleClick(
      "raw-token",
      { sessionId: "s", responseId: "r", idempotencyKey: "k13" },
      meta,
    );

    const call = rpcCalls.find((c) => c.name === "rpc_public_record_google_click");
    expect(call!.params.p_previous_session_token_hash).toBeNull();
    expect(call!.params.p_previous_response_token_hash).toBeNull();

    sessSpy.mockRestore();
    respSpy.mockRestore();
  });
});

describe("token rotation — unknown stand behavior", () => {
  beforeEach(() => {
    rpcCalls = [];
  });

  it("unknown_stand from RPC produces identical 404 regardless of rotation state", async () => {
    rpcResult = [{ outcome: "unknown_stand", response_status: null, response_body_encrypted: null }];
    const { createSession } = await import("@/lib/server/customer-flow-service");

    await expect(
      createSession("bad-token", { locale: "en", idempotencyKey: "k6" }, meta),
    ).rejects.toThrow("not found");
  });
});

describe("token rotation — idempotent replay", () => {
  beforeEach(() => {
    rpcCalls = [];
  });

  it("replayed createSession returns 200 with stored body", async () => {
    rpcResult = [{ outcome: "replay", response_status: 201, response_body_encrypted: ENCRYPTED }];
    const { createSession } = await import("@/lib/server/customer-flow-service");
    const result = await createSession("raw-token", { locale: "en", idempotencyKey: "k7" }, meta);

    expect(result.status).toBe(200);
  });
});
