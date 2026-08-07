/**
 * Google review destination validation.
 *
 * The public context endpoint hands this URL to a browser, so an unvalidated
 * value is an open redirect with the business's own QR code as the lure. Two
 * separate things are being prevented:
 *
 *   1. Redirecting a customer to somewhere that is not Google at all.
 *   2. Sending them to a Google page that is not a review destination.
 *
 * The allowlist is deliberately narrow and matches the client-side validator
 * exactly. If this were the looser of the two, the frontend would reject a URL
 * the API had just declared valid and the customer would see a broken flow for
 * a reason no log explains.
 */

/** Short links. Google issues these from the business profile itself. */
const SHORT_LINK_HOSTS = new Set(['g.page', 'maps.app.goo.gl']);

export function isValidGoogleReviewUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // Credentials in a URL are a phishing primitive: https://google.com@evil.example
  // is not Google, and the hostname check alone would not catch it.
  if (url.protocol !== 'https:' || url.username || url.password) return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  if (SHORT_LINK_HOSTS.has(host)) return true;

  if (host === 'search.google.com') {
    return url.pathname === '/local/writereview' && Boolean(url.searchParams.get('placeid'));
  }

  if (host === 'www.google.com' || host === 'maps.google.com') {
    return url.pathname.startsWith('/maps/');
  }

  return false;
}
