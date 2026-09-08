import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

describe("handle — ConfigError is a closed 503", () => {
  it("maps ConfigError to opaque service_unavailable, never leaking the message", async () => {
    const { handle } = await import("@/lib/server/http");
    const { ConfigError } = await import("@/lib/server/env");

    const response = await handle(new Request("http://localhost/api/v1/x"), "/api/v1/x", async () => {
      throw new ConfigError("SMS_PROVIDER is required.");
    });

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("service_unavailable");
    expect(body.error.message).not.toMatch(/SMS_PROVIDER/);
    expect(body.error.message).toBe("Please try again shortly.");
  });

  it("still reports unexpected bugs as opaque 500", async () => {
    const { handle } = await import("@/lib/server/http");

    const response = await handle(new Request("http://localhost/api/v1/x"), "/api/v1/x", async () => {
      throw new Error("boom");
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
  });
});
