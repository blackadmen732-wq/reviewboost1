import { afterEach, expect, it, vi } from "vitest";
import {
  OWNER_READ_TIMEOUT_MS,
  ReadTimeoutError,
  withReadDeadline,
} from "@/lib/api/read-deadline";
afterEach(() => vi.useRealTimers());
it("rejects a stalled read even when the underlying operation ignores abort", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const result = withReadDeadline((s) => {
    signal = s;
    return new Promise<never>(() => undefined);
  });
  const assertion = expect(result).rejects.toBeInstanceOf(ReadTimeoutError);
  await vi.advanceTimersByTimeAsync(OWNER_READ_TIMEOUT_MS);
  await assertion;
  expect(signal?.aborted).toBe(true);
});
it("cleans its deadline after a successful read", async () => {
  vi.useFakeTimers();
  expect(await withReadDeadline(async () => 42)).toBe(42);
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels a read when its screen unmounts", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const result = withReadDeadline(
    () => new Promise<never>(() => undefined),
    controller.signal,
  );
  const assertion = expect(result).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it("ends a stalled write with an uncertain outcome and does not replay it", async () => {
  const { withWriteDeadline, OWNER_WRITE_TIMEOUT_MS, WriteTimeoutError } =
    await import("@/lib/api/read-deadline");
  vi.useFakeTimers();
  const write = vi.fn(() => new Promise<never>(() => undefined));
  const result = withWriteDeadline(write);
  const assertion = expect(result).rejects.toBeInstanceOf(WriteTimeoutError);
  await vi.advanceTimersByTimeAsync(OWNER_WRITE_TIMEOUT_MS);
  await assertion;
  expect(write).toHaveBeenCalledTimes(1);
});
