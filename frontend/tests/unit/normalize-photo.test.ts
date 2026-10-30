import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_LONG_EDGE,
  MAX_UPLOAD_BYTES,
  MIN_LONG_EDGE,
  MIN_QUALITY,
  NormalizePhotoError,
  TARGET_BYTES,
  canSendAsIs,
  encodeWithinBudget,
  fitWithin,
  isHeic,
  isPhotoInput,
  readJpegExif,
} from "@/lib/images/normalize-photo";

/** A minimal JPEG: SOI, optional APP1 Exif with an orientation tag, SOS. */
function jpeg({ orientation, littleEndian = false }: { orientation?: number; littleEndian?: boolean }) {
  const bytes: number[] = [0xff, 0xd8];
  if (orientation !== undefined) {
    const u16 = (v: number) => (littleEndian ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
    const u32 = (v: number) =>
      littleEndian
        ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]
        : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    const tiff = [
      ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(42),
      ...u32(8),
      ...u16(1), // one IFD entry
      ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
      ...u32(0),
    ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const length = payload.length + 2;
    bytes.push(0xff, 0xe1, length >> 8, length & 0xff, ...payload);
  }
  bytes.push(0xff, 0xda, 0, 2);
  return new Uint8Array(bytes).buffer;
}

const blobOf = (size: number) => ({ size }) as Blob;

describe("photo normalization", () => {
  it("uses the same 5 MiB limit as the server and the bucket", () => {
    const service = readFileSync(join(process.cwd(), "lib/server/customer-page-service.ts"), "utf8");
    expect(service).toContain("export const MAX_ASSET_BYTES = 5 * 1024 * 1024;");
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    expect(TARGET_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
    // Every customer downloads this photo on the page they see at the counter.
    // A budget near the bucket's 5 MiB let a 4.5 MB PNG reach them untouched.
    expect(TARGET_BYTES).toBeLessThanOrEqual(1.5 * 1024 * 1024);

    const bucket = readFileSync(
      join(process.cwd(), "../supabase/migrations/20260926000100_customer_page_bucket.sql"),
      "utf8",
    );
    expect(bucket).toContain("5242880");
  });

  it("reads EXIF orientation in both byte orders, and knows when there is none", () => {
    expect(readJpegExif(jpeg({ orientation: 6 }))).toEqual({ hasExif: true, orientation: 6 });
    expect(readJpegExif(jpeg({ orientation: 3, littleEndian: true }))).toEqual({ hasExif: true, orientation: 3 });
    expect(readJpegExif(jpeg({}))).toEqual({ hasExif: false, orientation: null });
    expect(readJpegExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({
      hasExif: false,
      orientation: null,
    });
  });

  it("does not throw on a truncated EXIF block", () => {
    const whole = new Uint8Array(jpeg({ orientation: 8 }));
    expect(() => readJpegExif(whole.slice(0, 20).buffer)).not.toThrow();
  });

  it("shrinks the long edge to the ceiling, keeps the aspect, never enlarges", () => {
    expect(fitWithin(8064, 6048, MAX_LONG_EDGE)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin(3024, 4032, MAX_LONG_EDGE)).toEqual({ width: 1800, height: 2400 });
    expect(fitWithin(1200, 900, MAX_LONG_EDGE)).toEqual({ width: 1200, height: 900 });
  });

  it("sends a file untouched only when it is already fine", () => {
    const ok = { type: "image/jpeg", size: 900_000, width: 2000, height: 1500, jpegHasExif: false };
    expect(canSendAsIs(ok)).toBe(true);
    expect(canSendAsIs({ ...ok, type: "image/png" })).toBe(true);
    // A camera JPEG carries EXIF: it may be sideways and may say where it was taken.
    expect(canSendAsIs({ ...ok, jpegHasExif: true })).toBe(false);
    expect(canSendAsIs({ ...ok, size: TARGET_BYTES + 1 })).toBe(false);
    expect(canSendAsIs({ ...ok, width: MAX_LONG_EDGE + 1 })).toBe(false);
    expect(canSendAsIs({ ...ok, type: "image/heic" })).toBe(false);
  });

  it("recognises HEIC by type or by name, and refuses SVG", () => {
    expect(isHeic({ type: "image/heic", name: "a" })).toBe(true);
    expect(isHeic({ type: "", name: "IMG_0001.HEIC" })).toBe(true);
    expect(isHeic({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
    expect(isPhotoInput({ type: "image/heif", name: "x" })).toBe(true);
    expect(isPhotoInput({ type: "", name: "photo.jpeg" })).toBe(true);
    expect(isPhotoInput({ type: "image/svg+xml", name: "logo.svg" })).toBe(false);
    expect(isPhotoInput({ type: "application/pdf", name: "menu.pdf" })).toBe(false);
  });

  it("keeps the highest quality that fits", async () => {
    const calls: number[] = [];
    const result = await encodeWithinBudget(2400, 1800, async (_w, _h, q) => {
      calls.push(q);
      return blobOf(q > 0.9 ? TARGET_BYTES + 1 : TARGET_BYTES - 1);
    });
    expect(calls).toEqual([0.92, 0.88]);
    expect(result).toMatchObject({ width: 2400, height: 1800 });
  });

  it("scales down rather than compressing below the quality floor", async () => {
    const calls: Array<[number, number, number]> = [];
    const result = await encodeWithinBudget(2400, 1800, async (w, h, q) => {
      calls.push([w, h, q]);
      expect(q).toBeGreaterThanOrEqual(MIN_QUALITY);
      return blobOf(w > 1800 ? TARGET_BYTES * 2 : TARGET_BYTES - 1);
    });
    expect(result.width).toBeLessThanOrEqual(1800);
    expect(calls.every(([, , q]) => q >= MIN_QUALITY)).toBe(true);
  });

  it("says so when even the smallest acceptable size does not fit", async () => {
    await expect(
      encodeWithinBudget(2400, 1800, async () => blobOf(TARGET_BYTES * 10)),
    ).rejects.toBeInstanceOf(NormalizePhotoError);
    // It gave up at the size floor, not before.
    const sizes: number[] = [];
    await encodeWithinBudget(2400, 1800, async (w) => {
      sizes.push(w);
      return blobOf(TARGET_BYTES * 10);
    }).catch(() => undefined);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_LONG_EDGE);
  });
});
