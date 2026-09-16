import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const OLD_ENV = { ...process.env };

beforeAll(() => {
  // digestStandToken → tokenDigestKey → encryptionKey reads this; publicFrontendUrl
  // needs an absolute URL. Both are required for resolveStand to run at all.
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.PUBLIC_FRONTEND_URL = "https://app.example.com";
});

afterAll(() => {
  process.env = { ...OLD_ENV };
});

const load = () => import("@/lib/server/sms/text-request-service");

interface Row {
  data: unknown;
  error: unknown;
}

// A minimal chainable stand-in for the Supabase query builder: select/eq return
// self, maybeSingle resolves the per-table row we were given.
function makeContext(standRow: Row, locRow: Row) {
  const db = {
    from(table: string) {
      const row = table === "review_stands" ? standRow : locRow;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => row,
      };
      return builder;
    },
  };
  return { orgId: "7c000000-0000-0000-0000-00000000000a", userId: "u-1", role: "owner", db } as never;
}

describe("resolveTimezone — documented fallback policy", () => {
  it("keeps a valid IANA zone", async () => {
    const { resolveTimezone } = await load();
    expect(resolveTimezone("America/New_York")).toBe("America/New_York");
    expect(resolveTimezone("  Europe/London  ")).toBe("Europe/London");
  });

  it("falls back to UTC for missing, empty, or invalid zones", async () => {
    const { resolveTimezone, DEFAULT_LOCATION_TIMEZONE } = await load();
    expect(DEFAULT_LOCATION_TIMEZONE).toBe("UTC");
    expect(resolveTimezone(undefined)).toBe("UTC");
    expect(resolveTimezone(null)).toBe("UTC");
    expect(resolveTimezone("")).toBe("UTC");
    expect(resolveTimezone("Not/AZone")).toBe("UTC");
  });
});

describe("resolveStand — fail closed on the timezone lookup", () => {
  const okStand: Row = { data: { id: "s1", location_id: "l1" }, error: null };

  it("uses the location's timezone on success", async () => {
    const { resolveStand } = await load();
    const ctx = makeContext(okStand, { data: { timezone: "America/New_York" }, error: null });
    const r = await resolveStand(ctx, { standToken: "tokentokentoken" });
    expect(r.timezone).toBe("America/New_York");
    expect(r.standId).toBe("s1");
    expect(r.locationId).toBe("l1");
  });

  it("fails closed (503) when the location query errors — never silently UTC", async () => {
    const { resolveStand } = await load();
    const { ApiError } = await import("@/lib/server/errors");
    const ctx = makeContext(okStand, { data: null, error: { message: "connection reset" } });
    await expect(resolveStand(ctx, { standToken: "tokentokentoken" })).rejects.toMatchObject({ status: 503 });
    // Prove it is the typed API error, not some other throw.
    await resolveStand(ctx, { standToken: "tokentokentoken" }).catch((e) => {
      expect(e).toBeInstanceOf(ApiError);
    });
  });

  it("applies the documented UTC fallback for a successfully-read missing zone", async () => {
    const { resolveStand } = await load();
    const ctx = makeContext(okStand, { data: { timezone: null }, error: null });
    const r = await resolveStand(ctx, { standToken: "tokentokentoken" });
    expect(r.timezone).toBe("UTC");
  });

  it("still 404s when the stand is not found", async () => {
    const { resolveStand } = await load();
    const ctx = makeContext({ data: null, error: null }, { data: null, error: null });
    await expect(resolveStand(ctx, { standToken: "tokentokentoken" })).rejects.toMatchObject({ status: 404 });
  });

  it("fails closed (503) when the stand query errors", async () => {
    const { resolveStand } = await load();
    const ctx = makeContext({ data: null, error: { message: "db down" } }, { data: null, error: null });
    await expect(resolveStand(ctx, { standToken: "tokentokentoken" })).rejects.toMatchObject({ status: 503 });
  });
});
