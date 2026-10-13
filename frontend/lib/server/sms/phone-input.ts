import "server-only";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { normalizePhone, PhoneNormalizationError, type NormalizedPhone } from "@/lib/server/sms/phone";

/**
 * A number an owner typed, turned into E.164 or refused in words they can act on.
 *
 * Text Requests and Customers both take a number from an owner. Without this,
 * a typo reached the route as an unhandled PhoneNormalizationError and came
 * back as "Something went wrong on our side" — the owner's mistake reported as
 * ours, with nothing to fix.
 */

// A national number needs a country to become E.164; the deployment can carry
// a default. Kept configurable rather than hardcoded to one market.
function defaultCountryCallingCode(): string | undefined {
  const raw = process.env.SMS_DEFAULT_COUNTRY_CALLING_CODE;
  return raw && /^\d{1,3}$/.test(raw) ? raw : undefined;
}

export const PHONE_HELP = "Enter a mobile number with its country code, like +1 555 201 0142.";

export function parseOwnerPhone(raw: string, field = "phone"): NormalizedPhone {
  const cc = defaultCountryCallingCode();
  try {
    return normalizePhone(raw, cc ? { defaultCountryCallingCode: cc } : undefined);
  } catch (error) {
    if (error instanceof PhoneNormalizationError) {
      throw new ApiError(400, ERROR_CODE.validationFailed, PHONE_HELP, {
        details: [{ field, message: PHONE_HELP }],
      });
    }
    throw error;
  }
}
