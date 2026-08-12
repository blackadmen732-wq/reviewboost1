/**
 * Validate a post-login redirect destination.
 *
 * Rejects protocol-relative paths, backslash tricks, external origins,
 * control characters, and anything that would change the origin when
 * resolved by the browser.
 */

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

export function safeInternalPath(
  raw: string | null | undefined,
  origin: string,
  fallback = "/home",
): string {
  if (!raw) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }

  if (hasControlChars(decoded)) return fallback;
  if (decoded.includes("\\")) return fallback;
  if (!decoded.startsWith("/")) return fallback;
  if (decoded.startsWith("//")) return fallback;

  let url: URL;
  try {
    url = new URL(decoded, origin);
  } catch {
    return fallback;
  }

  if (url.origin !== origin) return fallback;
  if (url.username || url.password) return fallback;

  return url.pathname + url.search + url.hash;
}
