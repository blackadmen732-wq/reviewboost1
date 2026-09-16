import "server-only";

/**
 * Provider-independent SMS rate model.
 *
 * Every provider quotes prices differently — Twilio by ISO country + MCC/MNC,
 * others by prefix or by a flat per-country deck — so the routing and pricing
 * engine never speaks a provider's dialect directly. Each provider gets an
 * adapter that normalises its prices into the single shape below, and the
 * business logic (cost model, router, quote) only ever sees `NormalizedRate`.
 * Adding Telnyx, Plivo, Vonage, or Sinch later is a new adapter, not a change to
 * anything downstream.
 *
 * Money is integer micro-units of `currency` (millionths), matching `cost.ts`.
 * There are no float prices anywhere in this system.
 */

/** SMS direction. Outbound is what ReviewBoost sends; inbound is replies. */
export type SmsDirection = "outbound" | "inbound";

/** The kind of sender number the price applies to. */
export type NumberType = "long_code" | "toll_free" | "short_code" | "sender_id" | "unknown";

/** Where a rate came from — an authenticated API, or a versioned manual deck. */
export type RateSource = "twilio_pricing_api" | "manual_deck" | "provider_api";

export interface NormalizedRate {
  provider: string; // "twilio", "telnyx", …
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
  /** Mobile Country Code, when the provider exposes carrier granularity. */
  mcc: string | null;
  /** Mobile Network Code, when available. */
  mnc: string | null;
  /** Human carrier label, when available (e.g. "Verizon Wireless"). */
  carrier: string | null;
  numberType: NumberType;
  direction: SmsDirection;

  /** Provider list ("base") price per segment, micro-units. */
  basePriceMicros: number;
  /**
   * Account-specific ("current") price per segment, micro-units — reflects
   * volume or negotiated pricing. Prefer this over base when present and
   * legitimately sourced.
   */
  currentPriceMicros: number | null;
  /** Carrier pass-through surcharge per segment, micro-units, when the provider itemises it. */
  carrierSurchargeMicros: number | null;

  /** ISO-4217, uppercase. */
  currency: string;
  source: RateSource;

  /** When the price took effect at the provider. */
  effectiveAt: Date;
  /** When we fetched/imported it. */
  fetchedAt: Date;
  /** After this instant the rate is stale and must not price a live send. */
  expiresAt: Date | null;
  /** Monotonic version of the rate row for this key; higher wins. */
  rateVersion: number;
}

/** The per-segment price actually used for costing, and which field it came from. */
export interface EffectiveRate {
  perSegmentMicros: number;
  carrierSurchargeMicros: number;
  currency: string;
  provider: string;
  usedCurrentPrice: boolean;
  rateVersion: number;
}

function assertSafeNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

/**
 * Is a rate too old to price a live send? A rate with no expiry is treated as
 * perpetual only for the manual deck (which carries its own explicit version);
 * an API rate should always set `expiresAt`. Callers that must fail closed on
 * staleness pass the current time and check the boolean.
 */
export function isRateStale(rate: NormalizedRate, now: Date = new Date()): boolean {
  if (rate.expiresAt === null) return false;
  return rate.expiresAt.getTime() <= now.getTime();
}

/**
 * Reduce a normalized rate to the single per-segment price to cost with. Prefers
 * the account-specific current price when present (it reflects the real
 * negotiated cost); otherwise the base price. Validates integer bounds so an
 * adapter cannot smuggle a float or an unsafe integer downstream.
 */
export function toEffectiveRate(rate: NormalizedRate): EffectiveRate {
  if (!/^[A-Z]{3}$/.test(rate.currency)) {
    throw new Error("Rate currency must be an uppercase ISO-4217 code.");
  }
  assertSafeNonNegativeInt(rate.basePriceMicros, "basePriceMicros");
  const surcharge = rate.carrierSurchargeMicros ?? 0;
  assertSafeNonNegativeInt(surcharge, "carrierSurchargeMicros");

  let perSegment: number;
  let usedCurrent: boolean;
  if (rate.currentPriceMicros !== null) {
    assertSafeNonNegativeInt(rate.currentPriceMicros, "currentPriceMicros");
    perSegment = rate.currentPriceMicros;
    usedCurrent = true;
  } else {
    perSegment = rate.basePriceMicros;
    usedCurrent = false;
  }

  return {
    perSegmentMicros: perSegment,
    carrierSurchargeMicros: surcharge,
    currency: rate.currency,
    provider: rate.provider,
    usedCurrentPrice: usedCurrent,
    rateVersion: rate.rateVersion,
  };
}

/** A rate lookup key: what we need a price *for*. */
export interface RateQuery {
  provider: string;
  country: string; // ISO-2, uppercase
  mcc?: string | null;
  mnc?: string | null;
  numberType: NumberType;
  direction: SmsDirection;
}

/**
 * The contract every provider rate adapter implements. `ingest` returns the
 * normalized rows a provider currently offers (for persistence); it MUST fail
 * closed — throw — when it has no legitimate authenticated source of prices,
 * rather than returning invented numbers. `configured` says whether real
 * credentials/data are present without performing a fetch.
 */
export interface ProviderRateAdapter {
  readonly provider: string;
  configured(): boolean;
  ingest(query: RateQuery): Promise<NormalizedRate[]>;
}
