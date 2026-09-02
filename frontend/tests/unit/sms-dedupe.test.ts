import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const KEY = Buffer.alloc(32, 3).toString("base64");
beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = KEY;
});

const load = () => import("@/lib/server/sms/dedupe");

const base = {
  orgId: "11111111-1111-1111-1111-111111111111",
  phoneHash: "a".repeat(64),
  standId: "22222222-2222-2222-2222-222222222222",
};

describe("review-request dedupe key", () => {
  it("is stable for the same recipient, stand, and window", async () => {
    const { reviewRequestDedupeKey } = await load();
    const now = new Date("2026-06-15T12:00:00Z");
    expect(reviewRequestDedupeKey({ ...base, now })).toBe(reviewRequestDedupeKey({ ...base, now }));
  });

  it("differs by recipient and by stand", async () => {
    const { reviewRequestDedupeKey } = await load();
    const now = new Date("2026-06-15T12:00:00Z");
    const a = reviewRequestDedupeKey({ ...base, now });
    expect(reviewRequestDedupeKey({ ...base, phoneHash: "b".repeat(64), now })).not.toBe(a);
    expect(reviewRequestDedupeKey({ ...base, standId: base.orgId, now })).not.toBe(a);
  });

  it("changes across window buckets", async () => {
    const { reviewRequestDedupeKey } = await load();
    const day1 = reviewRequestDedupeKey({ ...base, now: new Date("2026-06-15T12:00:00Z") });
    const day2 = reviewRequestDedupeKey({ ...base, now: new Date("2026-06-16T12:00:00Z") });
    expect(day1).not.toBe(day2);
  });

  it("stays stable within the same window bucket across the day", async () => {
    const { reviewRequestDedupeKey } = await load();
    const morning = reviewRequestDedupeKey({ ...base, now: new Date("2026-06-15T08:00:00Z") });
    const evening = reviewRequestDedupeKey({ ...base, now: new Date("2026-06-15T20:00:00Z") });
    expect(morning).toBe(evening);
  });

  it("honours an explicit idempotency key over the derived bucket", async () => {
    const { reviewRequestDedupeKey } = await load();
    const now = new Date("2026-06-15T12:00:00Z");
    const explicit = reviewRequestDedupeKey({ ...base, now, explicitKey: "client-key-abc" });
    const laterDay = reviewRequestDedupeKey({
      ...base,
      now: new Date("2026-09-01T00:00:00Z"),
      explicitKey: "client-key-abc",
    });
    expect(explicit).toBe(laterDay); // independent of time
    expect(explicit).not.toBe(reviewRequestDedupeKey({ ...base, now }));
  });
});
