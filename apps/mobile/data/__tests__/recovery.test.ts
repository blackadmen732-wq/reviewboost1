/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));

import * as api from "../api";
import {
  isOnline,
  isUnreachable,
  onBackOnline,
  reportReachable,
  reportUnreachable,
  resetConnection,
} from "../connection";
import {
  AUTO_RETRY_SECONDS,
  CHECK_BUDGET_MS,
  checkOutcome,
  isServerError,
  recoveryWords,
  RECHECK_SECONDS,
  STILL_WORKING_AFTER_MS,
  wasAnswered,
} from "../recovery";
import { forgetAllTries, useAutoRetry } from "../use-auto-retry";

const ApiError = api.ApiError as unknown as new (message: string, status: number) => Error;

/**
 * The iPhone app keeps the website's rhythm: screens that fail try again by
 * themselves (3 s, 10 s, 30 s), a lost answer is checked rather than repeated
 * (under 10 s), and the app learns it is offline from its own requests.
 */

beforeEach(() => {
  vi.useFakeTimers();
  forgetAllTries();
  resetConnection();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the rhythm and the words", () => {
  it("matches the website's numbers", () => {
    expect(STILL_WORKING_AFTER_MS).toBe(4_000);
    expect(AUTO_RETRY_SECONDS).toEqual([3, 10, 30]);
    expect(CHECK_BUDGET_MS).toBe(10_000);
    expect(RECHECK_SECONDS).toEqual([10, 30]);
  });

  it("says every line in twelve words or fewer, and never sends the owner to check", () => {
    for (const word of Object.values(recoveryWords)) {
      const line = typeof word === "function" ? word(10) : word;
      expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(12);
      expect(line, line).not.toMatch(/before trying|go and check/i);
    }
  });
});

describe("checkOutcome", () => {
  it("is done as soon as a read finds the change", async () => {
    await expect(checkOutcome(async () => true)).resolves.toBe("done");
  });

  it("looks for the whole time before it says not done", async () => {
    const read = vi.fn(async () => false);
    const outcome = checkOutcome(read, { random: () => 0.5 });
    await vi.advanceTimersByTimeAsync(CHECK_BUDGET_MS + 1_000);
    await expect(outcome).resolves.toBe("not-done");
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("takes the first answer as the truth after a server error", async () => {
    const read = vi.fn(async () => false);
    await expect(checkOutcome(read, { serverAnswered: true })).resolves.toBe("not-done");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("is unknown when nothing answers", async () => {
    const outcome = checkOutcome(async () => {
      throw new TypeError("Network request failed");
    });
    await vi.advanceTimersByTimeAsync(CHECK_BUDGET_MS + 1_000);
    await expect(outcome).resolves.toBe("unknown");
  });

  it("does not wait out a signed-out session", async () => {
    await expect(
      checkOutcome(async () => {
        throw new ApiError("Sign in.", 401);
      }),
    ).rejects.toThrow("Sign in.");
  });

  it("tells answers from silence", () => {
    expect(wasAnswered(new ApiError("No.", 422))).toBe(true);
    expect(wasAnswered(new ApiError("Not configured", 0))).toBe(false);
    expect(wasAnswered(new TypeError("Network request failed"))).toBe(false);
    expect(isServerError(new ApiError("Down.", 503))).toBe(true);
    expect(isServerError(new ApiError("No.", 409))).toBe(false);
  });
});

describe("the connection", () => {
  it("goes offline when a request cannot reach the server, and back on any answer", () => {
    const back = vi.fn();
    const stop = onBackOnline(back);
    expect(isUnreachable(new TypeError("Network request failed"))).toBe(true);
    expect(isUnreachable(new ApiError("No.", 409))).toBe(false);

    reportUnreachable();
    expect(isOnline()).toBe(false);
    reportReachable();
    expect(isOnline()).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("useAutoRetry", () => {
  function tick(seconds: number) {
    for (let second = 0; second < seconds; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }
  }

  it("counts down 3, 10, 30 s across failures, then stops", () => {
    const retry = vi.fn();
    const { result, rerender } = renderHook(
      ({ failure }) => useAutoRetry({ key: "screen", failure, onRetry: retry }),
      { initialProps: { failure: 1 } },
    );
    expect(result.current).toMatchObject({ phase: "waiting", secondsLeft: 3 });
    tick(3);
    expect(retry).toHaveBeenCalledTimes(1);

    rerender({ failure: 2 });
    expect(result.current).toMatchObject({ phase: "waiting", secondsLeft: 10 });
    tick(10);
    rerender({ failure: 3 });
    expect(result.current.secondsLeft).toBe(30);
    tick(30);
    rerender({ failure: 4 });
    expect(result.current.phase).toBe("stopped");
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it("waits for the connection while offline, and tries the moment it is back", () => {
    const retry = vi.fn();
    reportUnreachable();
    const { result } = renderHook(() => useAutoRetry({ key: "offline", failure: 1, onRetry: retry }));
    expect(result.current.phase).toBe("offline");
    tick(60);
    expect(retry).not.toHaveBeenCalled();
    act(() => reportReachable());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("looks for the connection by itself while offline", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://reviewboost.test");
    vi.resetModules();
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const connection = await import("../connection");
    connection.reportUnreachable();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetcher).toHaveBeenCalledWith("https://reviewboost.test/robots.txt", { method: "HEAD" });
    expect(connection.isOnline()).toBe(true);
    vi.unstubAllEnvs();
  });
});
