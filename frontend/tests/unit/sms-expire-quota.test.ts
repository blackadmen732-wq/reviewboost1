import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

describe("expireQuotaOnce", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("calls rpc_sms_quota_expire on the service-role client and returns the count", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const { expireQuotaOnce } = await import("@/lib/server/sms/expire-quota");
    await expect(expireQuotaOnce()).resolves.toEqual({ expired: 3 });
    expect(rpc).toHaveBeenCalledWith("rpc_sms_quota_expire");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("throws when the RPC fails rather than inventing a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const { expireQuotaOnce } = await import("@/lib/server/sms/expire-quota");
    await expect(expireQuotaOnce()).rejects.toMatchObject({ message: "db down" });
  });
});
