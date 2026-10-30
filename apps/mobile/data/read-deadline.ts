/** Native reads must recover even when an SDK or fetch never settles. Writes are not replayed. */
export const READ_TIMEOUT_MS = 20_000;
export const WRITE_TIMEOUT_MS = 30_000;
export function boundedRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  return deadline(
    read,
    READ_TIMEOUT_MS,
    "This is taking too long. Check your connection and try again.",
    signal,
  );
}
export function boundedWrite<T>(
  write: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  return deadline(
    write,
    WRITE_TIMEOUT_MS,
    "Could not confirm this change. Check its current state before trying again.",
    signal,
  );
}
async function deadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  timeout: number,
  message: string,
  signal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: (reason: unknown) => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
    timer = setTimeout(() => {
      const error = new Error(message);
      controller.abort();
      reject(error);
    }, timeout);
  });
  const abort = () => {
    controller.abort();
    rejectCancelled(new Error("Read cancelled."));
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return await Promise.race([
      cancelled,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error("Read cancelled.");
        return read(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
