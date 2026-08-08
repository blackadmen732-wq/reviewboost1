import "server-only";

import type { RequestMeta } from "@/lib/server/customer-flow-service";

/**
 * Per-request metadata for abuse controls.
 *
 * The address is read here and **never stored**. It is fed straight into a
 * keyed, daily-rotating digest, so what reaches the database is a fingerprint
 * that cannot be reversed and cannot follow a device across weeks.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy that sets it — Vercel
 * does. The leftmost entry is the client as that proxy saw it; entries after it
 * are hops. Taking the whole header, or the rightmost value, would let a client
 * choose its own rate-limit bucket by sending the header itself.
 */
export function requestMetaOf(request: Request, requestId: string): RequestMeta {
  return {
    address: clientAddress(request),
    userAgent: request.headers.get("user-agent"),
    requestId,
  };
}

function clientAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return groupIpv6(first);
  }

  const real = request.headers.get("x-real-ip");
  return real ? groupIpv6(real.trim()) : null;
}

/**
 * Group IPv6 to its /64 prefix.
 *
 * A single residential IPv6 allocation is typically a /64 or larger, so keying
 * on the full address would hand one attacker effectively unlimited distinct
 * buckets and make the limiter decorative. IPv4 is used whole.
 */
function groupIpv6(address: string): string {
  const unmapped = address.replace(/^::ffff:/i, "");
  if (!unmapped.includes(":")) return unmapped;
  return `${unmapped.split(":").slice(0, 4).join(":")}::/64`;
}
