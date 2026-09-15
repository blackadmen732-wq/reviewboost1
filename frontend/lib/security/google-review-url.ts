/**
 * Client-side Google review destination validation.
 *
 * @deprecated Import from `lib/security/destination.ts` for new code.
 */

import { requireValidatedDestinationUrl } from "@/lib/security/destination";

export { isValidatedGoogleReviewUrl } from "@/lib/security/destination";

export function requireValidatedGoogleReviewUrl(value: string): string {
  return requireValidatedDestinationUrl("google", value);
}
