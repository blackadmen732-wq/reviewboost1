/**
 * Turning a file the owner picked into something the customer page can render.
 *
 * A photograph off a phone is routinely 4000px wide and several megabytes, and
 * none of that survives being drawn into a hero that is at most 500 CSS pixels
 * across. Resizing here rather than on the way out means the preview is instant,
 * the stored design is small, and the customer downloads a photograph sized for
 * the page instead of for a camera sensor.
 *
 * The output is a data URL because there is no upload endpoint yet. When one
 * exists, this module is where the file goes instead — the design keeps holding
 * a string, and `safeImageSource` already accepts either form.
 */

export const acceptedImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export const maxSourceBytes = 20 * 1024 * 1024;

/** Wide enough for a 500px hero at 3x, and no wider. */
const heroMaxEdge = 1600;
/** A logo is small on the page and needs its transparency kept. */
const logoMaxEdge = 512;

export type ImageKind = "hero" | "logo";

export type ImageFileResult =
  | { ok: true; source: string }
  | { ok: false; reason: "type" | "size" | "decode" };

function targetEdge(kind: ImageKind): number {
  return kind === "hero" ? heroMaxEdge : logoMaxEdge;
}

async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // The bitmap is already drawn into the canvas by the time this runs on the
    // success path, and leaking one object URL per rejected file is still a leak.
    URL.revokeObjectURL(url);
  }
}

export async function readImageFile(
  file: File,
  kind: ImageKind,
): Promise<ImageFileResult> {
  if (!acceptedImageTypes.includes(file.type as (typeof acceptedImageTypes)[number])) {
    return { ok: false, reason: "type" };
  }
  if (file.size > maxSourceBytes) return { ok: false, reason: "size" };

  try {
    const image = await decode(file);
    const edge = targetEdge(kind);
    const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, reason: "decode" };
    context.drawImage(image, 0, 0, width, height);

    // A logo keeps its alpha channel; a photograph does not have one to keep and
    // is a third of the size as JPEG.
    const source =
      kind === "logo"
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", 0.82);

    return { ok: true, source };
  } catch {
    return { ok: false, reason: "decode" };
  }
}
