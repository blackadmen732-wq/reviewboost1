import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadWithProgress } from "@/lib/images/upload-with-progress";

/**
 * The photo upload reports how much has gone, so the button can show a
 * percentage that moves instead of an "Uploading…" that looks stuck.
 */

class FakeRequest {
  static last: FakeRequest | null = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  status = 0;
  headers: Record<string, string> = {};
  method = "";
  url = "";
  sent: unknown = null;
  aborted = false;
  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  finish(status: number) {
    this.status = status;
    this.onload?.();
    this.onloadend?.();
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("uploadWithProgress", () => {
  it("PUTs the file with its headers and reports progress to the end", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const seen: number[] = [];
    const body = new Blob(["photo"]);
    const done = uploadWithProgress("https://storage.test/upload", body, {
      headers: { "Content-Type": "image/jpeg", "x-upsert": "true" },
      onProgress: (fraction) => seen.push(fraction),
    });
    const request = FakeRequest.last!;
    expect(request.method).toBe("PUT");
    expect(request.headers).toEqual({ "Content-Type": "image/jpeg", "x-upsert": "true" });
    expect(request.sent).toBe(body);
    request.progress(25, 100);
    request.progress(100, 100);
    request.finish(200);
    await expect(done).resolves.toEqual({ ok: true, status: 200 });
    expect(seen).toEqual([0.25, 1]);
  });

  it("answers a refused upload like fetch would: not ok, with its status", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const done = uploadWithProgress("https://storage.test/upload", new Blob(["x"]), {
      headers: {},
      onProgress: () => {},
    });
    FakeRequest.last!.finish(403);
    await expect(done).resolves.toEqual({ ok: false, status: 403 });
  });

  it("fails like fetch on a dropped connection, and stops when cancelled", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const dropped = uploadWithProgress("https://storage.test/upload", new Blob(["x"]), {
      headers: {},
      onProgress: () => {},
    });
    FakeRequest.last!.onerror?.();
    await expect(dropped).rejects.toBeInstanceOf(TypeError);

    const controller = new AbortController();
    const cancelled = uploadWithProgress("https://storage.test/upload", new Blob(["x"]), {
      headers: {},
      signal: controller.signal,
      onProgress: () => {},
    });
    controller.abort(new DOMException("Took too long", "TimeoutError"));
    await expect(cancelled).rejects.toMatchObject({ name: "TimeoutError" });
    expect(FakeRequest.last!.aborted).toBe(true);
  });
});
