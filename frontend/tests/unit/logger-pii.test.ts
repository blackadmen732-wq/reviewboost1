import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The realistic leak: a database error object logged whole. PostgREST puts
 * the offending row in `details`, and Postgres puts values in messages.
 */
describe("log redaction of database errors", () => {
  it("drops PostgREST details, which can carry a whole row", async () => {
    const { __redactForTests } = await import("@/lib/server/logger");
    const out = __redactForTests({
      error: {
        code: "23514",
        message: "new row violates check constraint",
        details: "Failing row contains (5f0c..., +15551234567, secret body text).",
      },
    }) as { error: Record<string, unknown> };

    expect(out.error["details"]).toBe("[redacted]");
    expect(out.error["code"]).toBe("23514");
  });

  it("scrubs an E.164 number from any string, at any depth", async () => {
    const { __redactForTests } = await import("@/lib/server/logger");
    const out = JSON.stringify(
      __redactForTests({ nested: { reason: "provider rejected +447700900123 as unreachable" } }),
    );
    expect(out).not.toContain("447700900123");
    expect(out).toContain("[phone]");
  });

  it("leaves ids, codes and timestamps readable", async () => {
    const { __redactForTests } = await import("@/lib/server/logger");
    const input = { requestId: "0b8a1c9e-1f2a-4c3d-9e8f-123456789012", at: "2026-09-24T01:02:03.000Z", count: 12345678 };
    expect(__redactForTests(input)).toEqual(input);
  });
});
