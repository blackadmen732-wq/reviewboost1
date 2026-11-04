import "server-only";

/** Hosted artwork requires HTTPS. Plain HTTP is only a local development path. */
export function customerAssetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return value;
    if (
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
      return value;
  } catch {
    return null;
  }
  return null;
}
