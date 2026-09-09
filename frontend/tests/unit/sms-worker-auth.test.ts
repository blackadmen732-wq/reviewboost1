import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { smsWorkerAuthorized } = await import("@/lib/server/sms/worker-auth");

const KEYS = ["SMS_WORKER_SECRET", "CRON_SECRET"] as const;

function req(authorization?: string): Request {
  return new Request("http://localhost:3000/api/v1/internal/sms/dispatch", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("smsWorkerAuthorized", () => {
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("denies when no secret is configured", () => {
    expect(smsWorkerAuthorized(req("Bearer anything"))).toBe(false);
  });

  it("denies a missing or malformed Authorization header", () => {
    process.env.SMS_WORKER_SECRET = "secret";
    expect(smsWorkerAuthorized(req())).toBe(false);
    expect(smsWorkerAuthorized(req("secret"))).toBe(false);
    expect(smsWorkerAuthorized(req("Bearer secret extra"))).toBe(false);
  });

  it("accepts SMS_WORKER_SECRET and CRON_SECRET independently", () => {
    process.env.SMS_WORKER_SECRET = "worker";
    process.env.CRON_SECRET = "cron";
    expect(smsWorkerAuthorized(req("Bearer worker"))).toBe(true);
    expect(smsWorkerAuthorized(req("Bearer cron"))).toBe(true);
    expect(smsWorkerAuthorized(req("Bearer other"))).toBe(false);
  });
});
