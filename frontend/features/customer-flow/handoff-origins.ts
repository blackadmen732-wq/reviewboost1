/**
 * The hosts a review link passes through: the link's own host, Google's
 * sign-in (a customer who is not signed in to Google is sent there first) and
 * Google's main host (where short links and Maps links land).
 *
 * The page preconnects to these while the customer reads the question, so the
 * name lookup and the secure handshake are done before the tap rather than
 * after it. A preconnect sends no request and no cookies; it only opens the
 * connection.
 */
export function handoffOrigins(url: string): string[] {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return [];
  }
  return [...new Set([origin, ...GOOGLE_ORIGINS])];
}

const GOOGLE_ORIGINS = ["https://accounts.google.com", "https://www.google.com"] as const;
