/**
 * PUT a file and report how much of it has gone, as a fraction from 0 to 1.
 *
 * `fetch` cannot report upload progress, so this uses XMLHttpRequest, which
 * can. A photo on a slow connection takes long enough that "Uploading…" alone
 * looks stuck; a percentage that moves says it is not (Apple's guidance:
 * prefer a determinate indicator, and keep it moving).
 *
 * `stallMs` gives up on an upload that has stopped moving, not one that is
 * slow: the clock starts again with every bit of progress. On a weak signal a
 * photo can take longer than any fixed limit and still arrive; one that sends
 * nothing for that long will not.
 *
 * Resolves with the status, like a Response, so callers keep their checks.
 * Rejects as fetch does: a network failure is a TypeError, a cancel is the
 * signal's reason, and a stall is an `UploadStalledError`.
 */
export class UploadStalledError extends Error {
  constructor() {
    super("The upload stopped moving.");
    this.name = "UploadStalledError";
  }
}

export function uploadWithProgress(
  url: string,
  body: Blob,
  {
    headers,
    signal,
    onProgress,
    stallMs,
  }: {
    headers: Record<string, string>;
    signal?: AbortSignal;
    onProgress: (fraction: number) => void;
    /** Give up when nothing has moved for this long (none: never). */
    stallMs?: number;
  },
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(stall);
      signal?.removeEventListener("abort", abort);
    };
    // Settle first: a browser fires `abort` inside `request.abort()`, and the
    // reason given here (a cancel, a stall) is the one callers must see.
    const abort = () => {
      settle();
      reject(signal?.reason ?? new DOMException("Upload cancelled", "AbortError"));
      request.abort();
    };
    /** Each bit of progress starts the stall clock again. */
    const watch = () => {
      if (stallMs === undefined) return;
      clearTimeout(stall);
      stall = setTimeout(() => {
        settle();
        reject(new UploadStalledError());
        request.abort();
      }, stallMs);
    };

    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      watch();
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    request.onload = () => {
      settle();
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
      });
    };
    request.onerror = () => {
      settle();
      reject(new TypeError("The upload did not reach the server."));
    };
    request.ontimeout = request.onerror;
    // Stopped by something other than this code: never leave it unsettled.
    request.onabort = () => {
      settle();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    watch();
    request.send(body);
  });
}
