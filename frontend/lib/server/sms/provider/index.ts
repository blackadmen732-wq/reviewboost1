import "server-only";

import { ConfigError, deploymentTier } from "@/lib/server/env";
import type { ProviderRate } from "@/lib/server/sms/cost";
import { FakeSmsProvider } from "@/lib/server/sms/provider/fake-provider";
import {
  TwilioSmsProvider,
  twilioConfigProblems,
  twilioConfigured,
} from "@/lib/server/sms/provider/twilio";
import type { SmsProvider } from "@/lib/server/sms/provider/types";

/**
 * Provider selection.
 *
 * Decided by deployment tier, not by NODE_ENV (which is "production" on every
 * Preview too):
 *
 *   production   Twilio, fully configured. Nothing else. A paying customer's
 *                Text Request must never be "sent" by a fake that tells the
 *                business it went out.
 *   staging      Twilio if selected (for real-device verification), else the
 *                fake, explicitly.
 *   preview      The fake, always. A preview is built from any branch and
 *                must never be able to send a real message to a real phone.
 *   development / test
 *                The fake unless Twilio is selected and configured.
 */
export function getSmsProvider(): SmsProvider {
  const selected = (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();
  const tier = deploymentTier();

  if (tier === "production") {
    if (selected !== "twilio") {
      throw new ConfigError(
        `SMS_PROVIDER must be twilio in production (got ${selected || "nothing"}). ` +
          "The fake provider can never serve paying customers.",
      );
    }
    const problems = twilioConfigProblems();
    if (problems.length > 0) {
      throw new ConfigError(`Twilio is not ready for production: ${problems.join("; ")}`);
    }
    return new TwilioSmsProvider();
  }

  if (tier === "preview") {
    if (selected === "twilio") {
      throw new ConfigError(
        "SMS_PROVIDER=twilio is refused on a preview deployment. Previews never send real SMS.",
      );
    }
    return new FakeSmsProvider();
  }

  if (selected === "twilio") {
    if (twilioConfigured()) return new TwilioSmsProvider();
    if (tier === "staging") {
      throw new ConfigError("SMS_PROVIDER=twilio but Twilio credentials are not configured.");
    }
  }

  if (tier === "staging" && selected !== "fake") {
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
    const tier = deploymentTier();
    if (tier === "production" || tier === "staging") {
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
