import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AuthenticatedContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { createStand } from "@/lib/server/owner-service";

/**
 * createStand must not report success unless the reprint ciphertext is stored.
 *
 * Before this fix the NFC create path called the dropped
 * `rpc_set_stand_token_ciphertext` and ignored error / false / null. The
 * function returned a stand id and token; reprint later found no ciphertext.
 *
 * Product rule (same as createOrganization / rotate): one RPC, ciphertext
 * required, fail closed. Do not revive the standalone setter.
 */

type RpcResult = { data: unknown; error: unknown };

function contextWithRpc(
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> | RpcResult,
): { context: AuthenticatedContext; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const context = {
    userId: "user-1",
    db: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(rpc(name, args));
      },
    },
  } as unknown as AuthenticatedContext;
  return { context, calls };
}

const STAND_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const LOCATION_ID = "33333333-3333-3333-3333-333333333333";

function code(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
});

describe("createStand ciphertext fail-closed", () => {
  it("stores ciphertext atomically on rpc_create_stand and never calls the dropped setter", async () => {
    const { context, calls } = contextWithRpc((name) => {
      if (name === "rpc_create_stand") return { data: STAND_ID, error: null };
      return {
        data: null,
        error: { code: "42883", message: `function ${name} does not exist` },
      };
    });

    const created = await createStand(context, ORG_ID, LOCATION_ID, "Front Desk", "req-cipher-ok");

    expect(created.standId).toBe(STAND_ID);
    expect(created.standToken.length).toBeGreaterThan(8);
    expect(created.standUrl).toBe(`https://app.reviewboost.test/q/${created.standToken}`);

    expect(calls.map((call) => call.name)).toEqual(["rpc_create_stand"]);
    const args = calls[0]!.args;
    expect(typeof args.p_token_ciphertext).toBe("string");
    expect(String(args.p_token_ciphertext).length).toBeGreaterThan(0);
    expect(args.p_cipher_key_version).toBe(1);
    expect(args.p_stand_token_hash).not.toBe(created.standToken);
  });

  it("fails closed when rpc_create_stand errors — including a missing ciphertext setter", async () => {
    const { context, calls } = contextWithRpc((name) => {
      if (name === "rpc_create_stand") {
        return {
          data: null,
          error: {
            code: "42883",
            message: "function rpc_set_stand_token_ciphertext(uuid, text, smallint) does not exist",
          },
        };
      }
      return { data: STAND_ID, error: null };
    });

    await expect(createStand(context, ORG_ID, LOCATION_ID, "Front Desk", "req-cipher-err")).rejects.toMatchObject({
      status: 503,
      code: ERROR_CODE.serviceUnavailable,
    });
    expect(calls.map((call) => call.name)).toEqual(["rpc_create_stand"]);
  });

  it("does not report success when the create RPC returns false", async () => {
    const { context } = contextWithRpc(() => ({ data: false, error: null }));

    await expect(createStand(context, ORG_ID, LOCATION_ID, "Till 2", "req-cipher-false")).rejects.toMatchObject({
      status: 503,
      code: ERROR_CODE.serviceUnavailable,
    });
  });

  it("does not report success when the create RPC returns null", async () => {
    const { context } = contextWithRpc(() => ({ data: null, error: null }));

    await expect(createStand(context, ORG_ID, LOCATION_ID, "Bar", "req-cipher-null")).rejects.toBeInstanceOf(ApiError);
  });

  it("does not call rpc_set_stand_token_ciphertext in owner-service", () => {
    const source = code("lib/server/owner-service.ts");
    expect(source).not.toContain("rpc_set_stand_token_ciphertext");

    const start = source.indexOf("export async function createStand");
    const next = source.indexOf("export async function listCustomerResponses", start);
    const createStandSource = source.slice(start, next === -1 ? undefined : next);
    expect(createStandSource).toContain("p_token_ciphertext");
    expect(createStandSource).toContain("p_cipher_key_version");
  });
});
