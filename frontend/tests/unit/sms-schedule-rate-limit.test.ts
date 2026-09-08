import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  requireOrganizationContext: async () => ({
    orgId: "org-1",
    userId: "user-1",
    role: "owner",
    db: {},
  }),
  requireRole: () => undefined,
}));

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

vi.mock("@/lib/server/sms/text-request-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/sms/text-request-service")>();
  return {
    ...actual,
    scheduleTextRequest: async () => ({
      requestId: "tr-1",
      created: true,
      status: "scheduled",
      scheduledFor: "2026-06-15T13:00:00.000Z",
      segments: 1,
      recipientLastFour: "0000",
    }),
  };
});

vi.mock("@/lib/server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function request(body: unknown): NextRequest {
  return new Request("http://localhost:3000/api/v1/text-requests", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const VALID = { phone: "+15551230000", standToken: "tokentokentoken" };

beforeAll(() => {
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

beforeEach(() => {
  rpc.mockReset();
});

describe("POST /api/v1/text-requests — schedule rate-limit fail-closed", () => {
  it("schedules when the limiter allows", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 1 }], error: null });
    const { POST } = await import("@/app/api/v1/text-requests/route");
    const response = await POST(request(VALID));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "rpc_consume_rate_limit",
      expect.objectContaining({ p_bucket: "sms_schedule", p_bucket_key: "org-1" }),
    );
  });

  it("returns 429 when the per-org budget is exhausted", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 42 }], error: null });
    const { POST } = await import("@/app/api/v1/text-requests/route");
    const response = await POST(request(VALID));
    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(429);
    expect(body.error.code).toBe("rate_limited");
    expect(response.headers.get("retry-after")).toBe("42");
  });

  it("fails closed (503) when the rate-limit store is unreachable", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const { POST } = await import("@/app/api/v1/text-requests/route");
    const response = await POST(request(VALID));
    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("service_unavailable");
  });

  it("fails closed (503) on an empty limiter decision", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { POST } = await import("@/app/api/v1/text-requests/route");
    const response = await POST(request(VALID));
    expect(response.status).toBe(503);
  });

  it("rejects an invalid body without charging the schedule limiter", async () => {
    const { POST } = await import("@/app/api/v1/text-requests/route");
    const response = await POST(request({ phone: "x" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
