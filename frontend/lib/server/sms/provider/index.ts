import "server-only";

import { ConfigError } from "@/lib/server/env";
import type { ProviderRate } from "@/lib/server/sms/cost";
import { FakeSmsProvider } from "@/lib/server/sms/provider/fake-provider";
import { TwilioSmsProvider, twilioConfigured } from "@/lib/server/sms/provider/twilio";
import type { SmsProvider } from "@/lib/server/sms/provider/types";

/**
 * Provider selection and pricing configuration.
 *
 * The active provider is chosen by SMS_PROVIDER, defaulting to the fake in any
 * environment where Twilio is not configured, so development and tests never
 * touch a real gateway. In production a provider that is selected but not
 * configured is a hard configuration error rather than a silent no-op.
 */

export function getSmsProvider(): SmsProvider {
  const selected = (process.env.SMS_PROVIDER ?? "").toLowerCase();

  if (selected === "twilio") {
    if (!twilioConfigured() && process.env.NODE_ENV === "production") {
      throw new ConfigError("SMS_PROVIDER=twilio but Twilio credentials are not configured.");
    }
    if (twilioConfigured()) return new TwilioSmsProvider();
  }

  if (process.env.NODE_ENV === "production" && selected !== "fake") {
    throw new ConfigError(
      "No SMS provider is configured. Set SMS_PROVIDER=twilio with credentials, or SMS_PROVIDER=fake explicitly.",
    );
  }

  return new FakeSmsProvider();
}

/**
 * Per-segment price, externally configured. No production price is invented: in
 * production the rate must be supplied, and its absence throws rather than
 * guessing. Development falls back to a clearly labelled zero so a preview can
 * render without pretending to know a real cost.
 */
export function getProviderRate(): ProviderRate {
  const raw = process.env.SMS_RATE_PER_SEGMENT_MICROS;
  const currency = (process.env.SMS_RATE_CURRENCY ?? "USD").toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ConfigError("SMS_RATE_CURRENCY must be an uppercase ISO-4217 code.");
  }

  if (raw === undefined || raw === "") {
    if (process.env.NODE_ENV === "production") {
      throw new ConfigError("SMS_RATE_PER_SEGMENT_MICROS must be configured in production.");
    }
    return { perSegmentMicros: 0, currency };
  }

  const micros = Number(raw);
  // Safe integer, not merely integer: a configured value above 2^53 would lose
  // precision the moment it is multiplied by a segment count or handed to a
  // Postgres bigint, so reject it at configuration time rather than mischarge.
  if (!Number.isSafeInteger(micros) || micros < 0) {
    throw new ConfigError(
      "SMS_RATE_PER_SEGMENT_MICROS must be a non-negative safe integer (micro-units).",
    );
  }
  return { perSegmentMicros: micros, currency };
}
