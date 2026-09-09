import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const dispatchOnce = vi.fn();
const expireQuotaOnce = vi.fn();

vi.mock("@/lib/server/sms/dispatch", () => ({
  dispatchOnce: (...args: unknown[]) => dispatchOnce(...args),
}));

vi.mock("@/lib/server/sms/expire-quota", () => ({
  expireQuotaOnce: (...args: unknown[]) => expireQuotaOnce(...args),
}));

function request(
  method: string,
  path: string,
  auth?: string,
): NextRequest {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
  }) as unknown as NextRequest;
}

const SECRET_KEYS = ["SMS_WORKER_SECRET", "CRON_SECRET"] as const;

describe("internal SMS worker routes", () => {
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    dispatchOnce.mockReset();
    expireQuotaOnce.mockReset();
    dispatchOnce.mockResolvedValue({
      claimed: 0,
      submitted: 0,
      suppressed: 0,
      failed: 0,
      unknown: 0,
      deferred: 0,
      skipped: 0,
    });
    expireQuotaOnce.mockResolvedValue({ expired: 2 });
    for (const key of SECRET_KEYS) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of SECRET_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("hides dispatch when no worker secret is configured", async () => {
    const { POST } = await import("@/app/api/v1/internal/sms/dispatch/route");
    const response = await POST(request("POST", "/api/v1/internal/sms/dispatch", "Bearer anything"));
    expect(response.status).toBe(404);
    expect(dispatchOnce).not.toHaveBeenCalled();
  });

  it("hides expire-quota when the bearer token does not match", async () => {
    process.env.SMS_WORKER_SECRET = "correct-secret";
    const { POST } = await import("@/app/api/v1/internal/sms/expire-quota/route");
    const response = await POST(
      request("POST", "/api/v1/internal/sms/expire-quota", "Bearer wrong-secret"),
    );
    expect(response.status).toBe(404);
    expect(expireQuotaOnce).not.toHaveBeenCalled();
  });

  it("runs a fake dispatch batch when SMS_WORKER_SECRET matches", async () => {
    process.env.SMS_WORKER_SECRET = "worker-secret";
    const { POST } = await import("@/app/api/v1/internal/sms/dispatch/route");
    const response = await POST(
      request("POST", "/api/v1/internal/sms/dispatch", "Bearer worker-secret"),
    );
    expect(response.status).toBe(200);
    expect(dispatchOnce).toHaveBeenCalledWith({ limit: 25, leaseSeconds: 90 });
    const body = (await response.json()) as { data: { claimed: number } };
    expect(body.data.claimed).toBe(0);
  });

  it("accepts Vercel Cron GET with CRON_SECRET for dispatch and expire-quota", async () => {
    process.env.CRON_SECRET = "vercel-cron";
    const dispatch = await import("@/app/api/v1/internal/sms/dispatch/route");
    const expire = await import("@/app/api/v1/internal/sms/expire-quota/route");

    const dispatched = await dispatch.GET(
      request("GET", "/api/v1/internal/sms/dispatch", "Bearer vercel-cron"),
    );
    const expired = await expire.GET(
      request("GET", "/api/v1/internal/sms/expire-quota", "Bearer vercel-cron"),
    );

    expect(dispatched.status).toBe(200);
    expect(expired.status).toBe(200);
    expect(dispatchOnce).toHaveBeenCalledTimes(1);
    expect(expireQuotaOnce).toHaveBeenCalledTimes(1);
    const body = (await expired.json()) as { data: { expired: number } };
    expect(body.data.expired).toBe(2);
  });

  it("never imports a live Twilio client from the expire-quota worker", async () => {
    const source = readFileSync(
      join(process.cwd(), "lib/server/sms/expire-quota.ts"),
      "utf8",
    );
    expect(source).toContain("rpc_sms_quota_expire");
    expect(source).not.toMatch(/twilio|TWILIO_/i);
    expect(source).not.toContain("getSmsProvider");
  });
});

describe("vercel cron wiring", () => {
  it("schedules dispatch and credit expiry against the internal worker paths", () => {
    const vercel = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons: Array<{ path: string; schedule: string }> };

    expect(vercel.crons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/v1/internal/sms/dispatch" }),
        expect.objectContaining({ path: "/api/v1/internal/sms/expire-quota" }),
      ]),
    );
    for (const cron of vercel.crons) {
      expect(cron.schedule).toMatch(/^[0-9*,/\- ]+$/);
      // Vercel Hobby refuses expressions that run more than once per day
      // ("Hobby accounts are limited to daily cron jobs"). Keep both
      // schedules daily so preview deploys. External POSTs can still be denser.
      const [, hour] = cron.schedule.split(" ");
      expect(hour, cron.path).not.toBe("*");
      expect(cron.schedule, cron.path).not.toMatch(/^\*\//);
    }
  });
});
