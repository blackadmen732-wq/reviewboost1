/** Which setup steps this browser has already shown as done. */
export const SETUP_SEEN_COOKIE = "rb_setup_seen";

/** The cookie's value as step keys; null when this browser has never been told. */
export function parseSetupSeen(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // A mangled cookie is treated as a first visit: nothing animates.
    return null;
  }
  return value.split(",").filter((key) => /^[a-z-]{1,20}$/.test(key));
}
