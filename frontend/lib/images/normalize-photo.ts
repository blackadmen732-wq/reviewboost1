/**
 * Turn whatever an owner's phone hands the browser into a photo the Customer
 * Page upload accepts: JPEG, PNG or WebP, upright, and under 5 MiB.
 *
 * WHY THIS EXISTS
 * ---------------
 * The upload used to send the file exactly as picked. A photo straight off a
 * current iPhone or Android camera is routinely 4–12 MB and 12–48 megapixels,
 * so the storage bucket refused it after the owner had already watched it
 * "upload". A HEIC file was refused before it started.
 *
 * WHAT IT DOES
 * ------------
 * - Keeps the file untouched when it is already fine: an accepted type, within
 *   the byte budget and the size ceiling, and (for JPEG) carrying no EXIF block.
 * - Otherwise decodes it with the browser, which applies the EXIF orientation,
 *   scales it so its long edge is at most MAX_LONG_EDGE, and re-encodes it as
 *   JPEG. Re-encoding drops EXIF, including any GPS position, which is right
 *   for an image that is about to be publicly readable.
 * - Quality starts high and steps down only as far as the budget needs. It
 *   never goes below MIN_QUALITY: past that the photo is scaled down instead,
 *   because a smaller clean photo looks better on a phone than a blocky one.
 *
 * HEIC
 * ----
 * There is no conversion library here. Safari (iOS and macOS) decodes HEIC
 * natively, so on those browsers a HEIC file is converted like any other. A
 * browser that cannot decode it gets a plain explanation of what to do. iOS
 * already converts camera photos to JPEG for a file input that does not list
 * HEIC, which is why the editor's `accept` does not list it.
 */

/** Must match MAX_ASSET_BYTES in lib/server/customer-page-service.ts and the bucket. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * What every customer downloads. The live page shows the photo as it was
 * uploaded, with no resizing in between, to someone standing at a counter on
 * mobile data. A 2400-pixel JPEG at the quality floor fits in this for an
 * ordinary photo; one that does not is scaled down rather than sent heavy.
 * Well under MAX_UPLOAD_BYTES, which only the bucket enforces.
 */
export const TARGET_BYTES = Math.floor(1.5 * 1024 * 1024);

/**
 * Below this on the long edge, a photo looks soft across a large phone. It is
 * still accepted; the owner is told, so they can pick a sharper one.
 */
export const SOFT_LONG_EDGE = 1200;

/**
 * The customer page shows the photo full-width on a phone: about 1170 × 1570
 * device pixels on a large iPhone. 2400 keeps room for the cover crop on any
 * screen shape without shipping pixels nobody sees.
 */
export const MAX_LONG_EDGE = 2400;

/** Below this the photo is scaled down rather than compressed further. */
export const MIN_QUALITY = 0.8;
export const QUALITY_STEPS = [0.92, 0.88, 0.84, MIN_QUALITY] as const;

/** Each further scale-down step, once quality is at its floor. */
export const SCALE_STEP = 0.85;

/** Never scale the long edge below this to meet the budget. */
export const MIN_LONG_EDGE = 1200;

/**
 * What a transparent PNG's clear areas become in a JPEG: the page's own empty
 * photo-area colour, so a cut-out logo sits on the same ground it would anyway.
 */
export const TRANSPARENT_FILL = "#ffffff";

export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

export type NormalizeErrorCode = "heic-unsupported" | "unreadable" | "not-an-image" | "too-large";

export class NormalizePhotoError extends Error {
  constructor(
    readonly code: NormalizeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NormalizePhotoError";
  }
}

export interface NormalizedPhoto {
  blob: Blob;
  type: UploadType;
  width: number;
  height: number;
  /** False when the original file was already fine and is sent as picked. */
  converted: boolean;
}

const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

export function isHeic(file: { type: string; name: string }): boolean {
  return HEIC_TYPES.includes(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

function isUploadType(type: string): type is UploadType {
  return (UPLOAD_TYPES as readonly string[]).includes(type);
}

/**
 * Whether a file is something to try decoding at all. SVG is excluded: it is
 * not a photo, and rasterising an owner's vector file is not this feature.
 */
export function isPhotoInput(file: { type: string; name: string }): boolean {
  if (isHeic(file)) return true;
  const type = file.type.toLowerCase();
  if (type === "image/svg+xml") return false;
  if (type.startsWith("image/")) return true;
  // Some Android pickers hand over an empty type; judge by extension.
  return type === "" && /\.(jpe?g|png|webp|avif|gif)$/i.test(file.name);
}

// ------------------------------------------------------------------ EXIF ---

/**
 * The EXIF orientation of a JPEG (1–8), or null when there is none. Only read
 * to decide whether a file can be sent untouched; the browser's decoder is
 * what actually rotates the pixels.
 */
export function readJpegExif(buffer: ArrayBuffer): { hasExif: boolean; orientation: number | null } {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return { hasExif: false, orientation: null };

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) break;
    // Start of scan: no metadata segments follow.
    if (marker === 0xffda) break;
    const length = view.getUint16(offset + 2);
    if (length < 2) break;

    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      return { hasExif: true, orientation: readTiffOrientation(view, offset + 10, offset + 2 + length) };
    }
    offset += 2 + length;
  }
  return { hasExif: false, orientation: null };
}

function readTiffOrientation(view: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end || end > view.byteLength) return null;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return null;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

// ------------------------------------------------------------- planning ---

/** The long edge brought down to `maxLongEdge`, aspect kept, never enlarged. */
export function fitWithin(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether the picked file can go up exactly as it is. Size and type alone are
 * not enough for a JPEG: one with EXIF may be sideways until something applies
 * the orientation, and its metadata may carry where it was taken.
 */
export function canSendAsIs(file: {
  type: string;
  size: number;
  width: number;
  height: number;
  jpegHasExif: boolean;
}): boolean {
  if (!isUploadType(file.type)) return false;
  if (file.size > TARGET_BYTES) return false;
  if (Math.max(file.width, file.height) > MAX_LONG_EDGE) return false;
  if (file.type === "image/jpeg" && file.jpegHasExif) return false;
  return true;
}

export type Encoder = (width: number, height: number, quality: number) => Promise<Blob>;

/**
 * Encode at the highest quality that fits, then smaller sizes at the quality
 * floor. Stops at the first result within TARGET_BYTES.
 */
export async function encodeWithinBudget(
  width: number,
  height: number,
  encode: Encoder,
): Promise<{ blob: Blob; width: number; height: number }> {
  for (const quality of QUALITY_STEPS) {
    const blob = await encode(width, height, quality);
    if (blob.size <= TARGET_BYTES) return { blob, width, height };
  }

  let size = { width, height };
  while (Math.max(size.width, size.height) * SCALE_STEP >= MIN_LONG_EDGE) {
    size = fitWithin(size.width, size.height, Math.round(Math.max(size.width, size.height) * SCALE_STEP));
    const blob = await encode(size.width, size.height, MIN_QUALITY);
    if (blob.size <= TARGET_BYTES) return { blob, ...size };
  }

  throw new NormalizePhotoError(
    "too-large",
    "That photo is too detailed to prepare for the page. Try a different one.",
  );
}

// --------------------------------------------------------------- browser ---

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Decode with EXIF orientation applied — the browser does the rotating. */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to <img>, which some browsers decode more formats with.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    // `image-orientation: from-image` is the default for <img> in every
    // current browser, and drawImage honours it.
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Scale in halving steps when shrinking by more than half: a single big
 * drawImage skips pixels and turns fine detail — signage, brickwork — into
 * shimmer.
 */
function draw(decoded: Decoded, width: number, height: number): HTMLCanvasElement {
  let source: CanvasImageSource = decoded.source;
  let sw = decoded.width;
  let sh = decoded.height;

  while (sw / 2 >= width && sh / 2 >= height) {
    const half = canvas(Math.round(sw / 2), Math.round(sh / 2));
    const hctx = half.getContext("2d");
    if (!hctx) break;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(source, 0, 0, half.width, half.height);
    source = half;
    sw = half.width;
    sh = half.height;
  }

  const out = canvas(width, height);
  const ctx = out.getContext("2d");
  if (!ctx) throw new NormalizePhotoError("unreadable", "This browser could not prepare the photo.");
  ctx.fillStyle = TRANSPARENT_FILL;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return out;
}

function toJpeg(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new NormalizePhotoError("unreadable", "This browser could not prepare the photo."))),
      "image/jpeg",
      quality,
    );
  });
}

export async function normalizePhoto(file: File): Promise<NormalizedPhoto> {
  if (!isPhotoInput(file)) {
    throw new NormalizePhotoError("not-an-image", "Choose a photo: JPEG, PNG, WebP or HEIC.");
  }

  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    if (isHeic(file)) {
      throw new NormalizePhotoError(
        "heic-unsupported",
        "This browser can’t open HEIC photos. On iPhone, choose it from Photos and it is converted for you — or save it as a JPEG first.",
      );
    }
    throw new NormalizePhotoError("unreadable", "That photo could not be opened. Try a JPEG or PNG.");
  }

  try {
    const jpegHasExif =
      file.type === "image/jpeg" ? readJpegExif(await file.slice(0, 256 * 1024).arrayBuffer()).hasExif : false;

    if (
      canSendAsIs({ type: file.type, size: file.size, width: decoded.width, height: decoded.height, jpegHasExif })
    ) {
      return {
        blob: file,
        type: file.type as UploadType,
        width: decoded.width,
        height: decoded.height,
        converted: false,
      };
    }

    const target = fitWithin(decoded.width, decoded.height, MAX_LONG_EDGE);
    // Draw once per size; only the quality changes between most attempts.
    let drawn: HTMLCanvasElement | null = null;
    const result = await encodeWithinBudget(target.width, target.height, (w, h, q) => {
      if (!drawn || drawn.width !== w || drawn.height !== h) drawn = draw(decoded, w, h);
      return toJpeg(drawn, q);
    });
    return { blob: result.blob, type: "image/jpeg", width: result.width, height: result.height, converted: true };
  } finally {
    decoded.close();
  }
}
