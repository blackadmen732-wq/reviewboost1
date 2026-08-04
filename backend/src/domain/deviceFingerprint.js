/**
 * Coarse device identification for the account activity log.
 *
 * The goal is narrow: answer "have you signed in from this browser and network
 * before?" so an unrecognised sign-in can be flagged. It is deliberately not a
 * tracking fingerprint — the inputs are only the browser family, the platform
 * family, and the network prefix, all of which are shared by millions of
 * devices and none of which are stored raw.
 *
 * Deliberately tolerant of a changing host address within the same network, so
 * a normal DHCP lease renewal does not read as a suspicious new device and
 * train users to ignore the alert.
 */

/** @returns {string} e.g. "Chrome on macOS" */
export function describeDevice(userAgent) {
  const value = String(userAgent ?? '');
  if (!value.trim()) return 'Unknown device';

  // Order matters: Edge and Opera both claim to be Chrome, and Chrome claims
  // to be Safari, so the more specific tokens have to be tested first.
  const browser = /\bedg(?:e|ios|a)?\//i.test(value)
    ? 'Edge'
    : /\bopr\/|\bopera\b/i.test(value)
      ? 'Opera'
      : /\bfirefox\/|\bfxios\//i.test(value)
        ? 'Firefox'
        : /\bchrome\/|\bcrios\//i.test(value)
          ? 'Chrome'
          : /\bsafari\//i.test(value)
            ? 'Safari'
            : /\bcurl\/|\bwget\/|postman|insomnia|python-requests|node-fetch/i.test(value)
              ? 'API client'
              : /bot|crawler|spider|preview/i.test(value)
                ? 'Bot'
                : 'Unknown browser';

  const platform = /\biphone\b|\bipad\b|\bipod\b/i.test(value)
    ? 'iOS'
    : /\bandroid\b/i.test(value)
      ? 'Android'
      : /\bmac os x\b|\bmacintosh\b/i.test(value)
        ? 'macOS'
        : /\bwindows\b/i.test(value)
          ? 'Windows'
          : /\bcros\b/i.test(value)
            ? 'ChromeOS'
            : /\blinux\b/i.test(value)
              ? 'Linux'
              : 'Unknown OS';

  return `${browser} on ${platform}`;
}

/** Broad device class, used for scan analytics rather than identity. */
export function classifyDevice(userAgent) {
  const value = String(userAgent ?? '').toLowerCase();
  if (!value.trim()) return 'unknown';
  if (/bot|crawler|spider|preview|headless/.test(value)) return 'bot';
  if (/ipad|tablet|playbook|silk/.test(value)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile/.test(value)) return 'mobile';
  if (/android/.test(value)) return 'tablet';
  return 'desktop';
}

/**
 * The network portion of an address.
 *
 * A /24 for IPv4 and the routing prefix for IPv6, so the same home or office
 * connection stays one device across a lease renewal.
 */
export function networkOf(ip) {
  const value = String(ip ?? '').trim();
  if (!value) return 'unknown';

  // Normalise the IPv4-mapped IPv6 form that Node reports behind some proxies.
  const unmapped = value.replace(/^::ffff:/i, '');

  if (unmapped.includes(':')) {
    return unmapped.split(':').slice(0, 4).join(':');
  }

  const octets = unmapped.split('.');
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.0/24` : unmapped;
}

/**
 * Stable identifier for "this browser on this network".
 *
 * @param {(value: string, domain: string) => string} hasher keyed HMAC — the
 *   inputs are low-entropy, so an unkeyed digest would be reversible.
 */
export function fingerprintDevice({ userAgent, ip, hasher }) {
  if (typeof hasher !== 'function') {
    throw new TypeError('fingerprintDevice requires a keyed hasher.');
  }
  return hasher(`${describeDevice(userAgent)}|${networkOf(ip)}`, 'device');
}
