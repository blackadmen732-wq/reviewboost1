import { afterEach, expect, it, vi } from "vitest";
import { boundedRead, READ_TIMEOUT_MS } from "../read-deadline";
afterEach(() => vi.useRealTimers());
it("recovers a stalled native SDK read even when it ignores cancellation", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const read = boundedRead((s) => {
    signal = s;
    return new Promise<never>(() => undefined);
  });
  const assertion = expect(read).rejects.toThrow(/taking too long/);
  await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
  await assertion;
  expect(signal?.aborted).toBe(true);
});
it("clears the deadline on success", async () => {
  vi.useFakeTimers();
  expect(await boundedRead(async () => "loaded")).toBe("loaded");
  expect(vi.getTimerCount()).toBe(0);
});
it("honors screen cancellation without leaking a timer", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const read = boundedRead(
    () => new Promise<never>(() => undefined),
    controller.signal,
  );
  const assertion = expect(read).rejects.toThrow(/cancelled/);
  controller.abort();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it("times out a native write without repeating its mutation", async () => {
  const { boundedWrite, WRITE_TIMEOUT_MS } = await import("../read-deadline");
  vi.useFakeTimers();
  const write = vi.fn(() => new Promise<never>(() => undefined));
  const result = boundedWrite(write);
  const assertion = expect(result).rejects.toThrow(/Could not confirm/);
  await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
  await assertion;
  expect(write).toHaveBeenCalledTimes(1);
});
