import "server-only";

import { publicFrontendUrl } from "@/lib/server/env";
import { isReviewBoostTagUrl } from "@/lib/security/tag-url";

/**
 * The one URL a Tag is ever given: what the QR code encodes, what an NFC chip
 * is programmed with, and the link a Text Request carries.
 *
 * Built from the configured ReviewBoost origin and the Tag's public token, and
 * nothing else — no destination, no location, no page setting — so none of
 * those can ever require a reprint. Checked before it is returned: a payload
 * that is not a plain `{origin}/q/{token}` fails closed here rather than being
 * printed onto something that cannot be recalled.
 */
export function canonicalTagUrl(token: string): string {
  const origin = publicFrontendUrl();
  const url = `${origin}/q/${encodeURIComponent(token)}`;
  if (!isReviewBoostTagUrl(url, origin)) {
    throw new Error("Refusing to issue a Tag URL that is not a canonical ReviewBoost /q/ link.");
  }
  return url;
}
