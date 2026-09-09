import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const lookupStatus = vi.fn();
const send = vi.fn();

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

vi.mock("@/lib/server/sms/provider", () => ({
  getSmsProvider: () => ({
    name: "fake",
    send,
    lookupStatus,
  }),
}));

import { authorizeSmsWorker } from "@/lib/server/sms/worker-auth";
import { expireCreditsOnce } from "@/lib/server/sms/expire-credits";
import { reconcileOnce } from "@/lib/server/sms/reconcile";

function request(path: string, auth?: string) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest;
}

describe("SMS worker authentication", () => {
  const previousWorker = process.env.SMS_WORKER_SECRET;
  const previousCron = process.env.CRON_SECRET;

  afterEach(() => {
    if (previousWorker === undefined) delete process.env.SMS_WORKER_SECRET;
    else process.env.SMS_WORKER_SECRET = previousWorker;
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
  });

  it("rejects when no secret is configured", () => {
    delete process.env.SMS_WORKER_SECRET;
    delete process.env.CRON_SECRET;
    expect(authorizeSmsWorker(request("/api/v1/internal/sms/dispatch", "Bearer anything"))).toBe(false);
  });

  it("rejects a wrong bearer", () => {
    process.env.SMS_WORKER_SECRET = "correct-secret";
    expect(authorizeSmsWorker(request("/x", "Bearer wrong-secret-xx"))).toBe(false);
  });

  it("accepts SMS_WORKER_SECRET", () => {
    process.env.SMS_WORKER_SECRET = "worker-secret-value";
    expect(authorizeSmsWorker(request("/x", "Bearer worker-secret-value"))).toBe(true);
  });

  it("accepts CRON_SECRET as the Vercel Cron bearer", () => {
    delete process.env.SMS_WORKER_SECRET;
    process.env.CRON_SECRET = "cron-secret-value";
    expect(authorizeSmsWorker(request("/x", "Bearer cron-secret-value"))).toBe(true);
  });
});

describe("credit-expiry scheduler", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("calls rpc_sms_quota_expire and reports the count", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expect(expireCreditsOnce()).resolves.toEqual({ expired: 3 });
    expect(rpc).toHaveBeenCalledWith("rpc_sms_quota_expire");
  });
});

describe("reconciliation scheduler — fake provider only", () => {
  beforeEach(() => {
    rpc.mockReset();
    lookupStatus.mockReset();
    send.mockReset();
  });

  it("applies a programmed fake lookup and never sends", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_list_unresolved_attempts") {
        return {
          data: [
            {
              id: "att-1",
              org_id: "org-1",
              request_id: "req-1",
              provider: "fake",
              provider_message_id: "fake_abc",
            },
          ],
          error: null,
        };
      }
      return { data: "delivered", error: null };
    });
    lookupStatus.mockResolvedValue({ terminal: "delivered" });

    await expect(reconcileOnce()).resolves.toEqual({
      scanned: 1,
      applied: 1,
      stillUnknown: 0,
      skipped: 0,
    });

    expect(send).not.toHaveBeenCalled();
    expect(lookupStatus).toHaveBeenCalledWith("fake_abc");
    expect(rpc).toHaveBeenCalledWith("rpc_sms_apply_delivery_status", {
      p_provider: "fake",
      p_provider_message_id: "fake_abc",
      p_terminal: "delivered",
      p_error_class: null,
    });
  });

  it("leaves attempts without a provider id unresolved — never retries a send", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "att-2",
          org_id: "org-1",
          request_id: "req-2",
          provider: "fake",
          provider_message_id: null,
        },
      ],
      error: null,
    });

    await expect(reconcileOnce()).resolves.toEqual({
      scanned: 1,
      applied: 0,
      stillUnknown: 0,
      skipped: 1,
    });
    expect(send).not.toHaveBeenCalled();
    expect(lookupStatus).not.toHaveBeenCalled();
  });
});

describe("internal SMS scheduler routes", () => {
  const previousWorker = process.env.SMS_WORKER_SECRET;

  beforeEach(() => {
    process.env.SMS_WORKER_SECRET = "scheduler-secret";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 0, error: null });
  });

  afterEach(() => {
    if (previousWorker === undefined) delete process.env.SMS_WORKER_SECRET;
    else process.env.SMS_WORKER_SECRET = previousWorker;
  });

  it("hides dispatch, reconcile, and expire-credits without a secret", async () => {
    delete process.env.SMS_WORKER_SECRET;
    delete process.env.CRON_SECRET;
    const routes = [
      "@/app/api/v1/internal/sms/dispatch/route",
      "@/app/api/v1/internal/sms/reconcile/route",
      "@/app/api/v1/internal/sms/expire-credits/route",
    ];

    for (const modulePath of routes) {
      const { POST } = await import(modulePath);
      const response = await POST(request("/internal"));
      expect(response.status, modulePath).toBe(404);
    }
  });

  it("runs expire-credits with the worker secret and does not send", async () => {
    const { POST } = await import("@/app/api/v1/internal/sms/expire-credits/route");
    const response = await POST(request("/api/v1/internal/sms/expire-credits", "Bearer scheduler-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ expired: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
