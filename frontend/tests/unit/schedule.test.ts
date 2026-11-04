import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Health measures each worker against the schedule that is deployed, read from
 * vercel.json. If the two disagree, an alert is either always red (nobody
 * reads it) or never red (nobody is warned).
 */
describe("the worker schedule health measures against", () => {
  it("reads every schedule vercel.json commits", async () => {
    const { workerIntervalSeconds } = await import("@/lib/server/schedule");
    expect(workerIntervalSeconds("sms_dispatch")).toBe(24 * 60 * 60);
    expect(workerIntervalSeconds("maintenance")).toBe(24 * 60 * 60);
  });

  it("allows one missed run plus slack", async () => {
    const { staleAfterSeconds } = await import("@/lib/server/schedule");
    expect(staleAfterSeconds("maintenance")).toBe(2 * 24 * 60 * 60 + 5 * 60);
  });

  it("reads the production cadence in docs/SCHEDULING.md the same way", async () => {
    const { cronIntervalSeconds } = await import("@/lib/server/schedule");
    expect(cronIntervalSeconds("* * * * *")).toBe(60);
    expect(cronIntervalSeconds("*/15 * * * *")).toBe(15 * 60);
    expect(cronIntervalSeconds("5 * * * *")).toBe(60 * 60);
    expect(cronIntervalSeconds("0 */6 * * *")).toBe(6 * 60 * 60);
    expect(cronIntervalSeconds("0 19 * * *")).toBe(24 * 60 * 60);
  });

  it("refuses a schedule it cannot read rather than guessing a limit", async () => {
    const { cronIntervalSeconds } = await import("@/lib/server/schedule");
    expect(() => cronIntervalSeconds("0 19 * * 1-5")).toThrow(/Unreadable/);
    expect(() => cronIntervalSeconds("@daily")).toThrow(/Unreadable/);
  });
});
