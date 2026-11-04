import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionExpiredError } from "@/lib/api/owner-fetch";
import { checkOutcome, isServerError } from "@/lib/recovery/check-outcome";
import { AUTO_RETRY_SECONDS, CHECK_BUDGET_MS, RECHECK_SECONDS, STILL_WORKING_AFTER_MS } from "@/lib/recovery/timing";
import { recoveryWords } from "@/lib/recovery/words";

vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowser: () => ({ auth: {} }) }));

/**
 * After a change's answer is lost, `checkOutcome` reads what is true now and
 * answers within ten seconds: done, not done, or no answer at all. These run
 * on a fake clock, so ten seconds here take none.
 */

const steady = () => 0.5; // no jitter: gaps are exactly 1, 2 and 4 s

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(CHECK_BUDGET_MS + 1_000);
  return promise;
}

describe("checkOutcome", () => {
  it("is done the moment a read finds the change", async () => {
    const read = vi.fn(async () => true);
    await expect(checkOutcome(read)).resolves.toBe("done");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps looking before it says not done: the server may still be finishing", async () => {
    const read = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(settle(checkOutcome(read, { random: steady }))).resolves.toBe("done");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("says not done only after four reads across the whole time", async () => {
    const read = vi.fn(async () => false);
    const outcome = checkOutcome(read, { random: steady });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(read).toHaveBeenCalledTimes(3);
    await expect(settle(outcome)).resolves.toBe("not-done");
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("after a server error, the first answer is the truth", async () => {
    // The server finished with the change before it answered, so there is
    // nothing to wait out.
    const read = vi.fn(async () => false);
    await expect(checkOutcome(read, { serverAnswered: true })).resolves.toBe("not-done");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("is unknown when no read answers, so nothing is repeated", async () => {
    const read = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(settle(checkOutcome(read, { random: steady }))).resolves.toBe("unknown");
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("is not done when some reads answered and none found it", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(false);
    await expect(settle(checkOutcome(read, { random: steady }))).resolves.toBe("not-done");
  });

  it("gives up on a read that never answers, and still answers in time", async () => {
    let aborted = false;
    const read = vi.fn(
      (signal: AbortSignal) =>
        new Promise<boolean>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    );
    const outcome = checkOutcome(read);
    await vi.advanceTimersByTimeAsync(CHECK_BUDGET_MS);
    await expect(outcome).resolves.toBe("unknown");
    expect(aborted).toBe(true);
  });

  it("does not wait out an expired session", async () => {
    const read = vi.fn(async () => {
      throw new SessionExpiredError();
    });
    await expect(checkOutcome(read)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("spreads its reads a little, so phones do not read in step", async () => {
    const at: number[] = [];
    const read = vi.fn(async () => {
      at.push(Date.now());
      return false;
    });
    const start = Date.now();
    await settle(checkOutcome(read, { random: () => 1 }));
    // +25% on each gap: 1.25 s, then 2.5 s.
    expect(at[1]! - start).toBe(1_250);
    expect(at[2]! - at[1]!).toBe(2_500);
  });
});

describe("the recovery rhythm and words", () => {
  it("keeps the numbers the brief promises", () => {
    expect(STILL_WORKING_AFTER_MS).toBe(4_000);
    expect(AUTO_RETRY_SECONDS).toEqual([3, 10, 30]);
    expect(CHECK_BUDGET_MS).toBe(10_000);
    expect(RECHECK_SECONDS).toEqual([10, 30]);
  });

  it("treats only a 5xx as a server error", () => {
    expect(isServerError({ status: 503 })).toBe(true);
    expect(isServerError({ status: 500 })).toBe(true);
    expect(isServerError({ status: 409 })).toBe(false);
  });

  it("says every line in twelve words or fewer, and never asks the owner to go and look", () => {
    const lines = Object.values(recoveryWords).map((word) =>
      typeof word === "function" ? word(10) : word,
    );
    for (const line of lines) {
      expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(12);
      expect(line, line).not.toMatch(/before trying|go and check|Something went wrong/i);
    }
  });
});
