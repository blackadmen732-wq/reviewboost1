/** Bound reads without replaying writes or relying on fetch to honor cancellation. */
export const OWNER_READ_TIMEOUT_MS = 20_000;

export class ReadTimeoutError extends Error {
  constructor() {
    super("This is taking too long. Check your connection and try again.");
    this.name = "ReadTimeoutError";
  }
}

export const OWNER_WRITE_TIMEOUT_MS = 30_000;
export class WriteTimeoutError extends Error {
  constructor() {
    super(
      "Could not confirm this change. Check its current state before trying again.",
    );
    this.name = "WriteTimeoutError";
  }
}
export function withReadDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  return boundedRequest(
    read,
    OWNER_READ_TIMEOUT_MS,
    new ReadTimeoutError(),
    signal,
  );
}
export function withWriteDeadline<T>(
  write: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  return boundedRequest(
    write,
    OWNER_WRITE_TIMEOUT_MS,
    new WriteTimeoutError(),
    signal,
  );
}
async function boundedRequest<T>(
  read: (signal: AbortSignal) => Promise<T>,
  timeout: number,
  error: Error,
  signal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: (reason: unknown) => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
    timer = setTimeout(() => {
      controller.abort(error);
      reject(error);
    }, timeout);
  });
  const abort = () => {
    const error =
      signal?.reason ?? new DOMException("Read cancelled", "AbortError");
    controller.abort(error);
    rejectCancelled(error);
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return await Promise.race([
      cancelled,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return read(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
