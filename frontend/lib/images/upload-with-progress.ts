/**
 * PUT a file and report how much of it has gone, as a fraction from 0 to 1.
 *
 * `fetch` cannot report upload progress, so this uses XMLHttpRequest, which
 * can. A photo on a slow connection takes long enough that "Uploading…" alone
 * looks stuck; a percentage that moves says it is not (Apple's guidance:
 * prefer a determinate indicator, and keep it moving).
 *
 * Resolves with the status, like a Response, so callers keep their checks.
 * Rejects as fetch does: a network failure is a TypeError, a cancel is the
 * signal's reason.
 */
export function uploadWithProgress(
  url: string,
  body: Blob,
  {
    headers,
    signal,
    onProgress,
  }: {
    headers: Record<string, string>;
    signal?: AbortSignal;
    onProgress: (fraction: number) => void;
  },
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    request.onload = () =>
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
      });
    request.onerror = () => reject(new TypeError("The upload did not reach the server."));
    request.ontimeout = request.onerror;
    const abort = () => {
      request.abort();
      reject(signal?.reason ?? new DOMException("Upload cancelled", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    request.onloadend = () => signal?.removeEventListener("abort", abort);
    request.send(body);
  });
}
