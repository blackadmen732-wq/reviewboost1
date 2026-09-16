import "server-only";

import type {
  NormalizedRate,
  ProviderRateAdapter,
  RateQuery,
} from "@/lib/server/sms/pricing/rates";

/**
 * Twilio Messaging Pricing adapter.
 *
 * Reads real prices from Twilio's Messaging Pricing API
 * (`https://pricing.twilio.com/v1/Messaging/Countries/{ISO2}`), which returns,
 * per country, `outbound_sms_prices` broken down by MCC/MNC/carrier with both a
 * list `base_price` and an account-specific `current_price` (which can reflect
 * volume or negotiated pricing). We prefer `current_price` when present because
 * it is the true cost to this account.
 *
 * NO INVENTED PRICES. Without real `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`
 * credentials the adapter reports itself unconfigured and `ingest` throws — it
 * never returns a guessed number. Prices are parsed to integer micro-units; a
 * malformed or non-finite price is rejected, not coerced.
 */

const PRICING_BASE = "https://pricing.twilio.com/v1/Messaging/Countries";

interface TwilioPrice {
  mcc?: string | null;
  mnc?: string | null;
  carrier?: string | null;
  number_type?: string | null;
  base_price?: string | number | null;
  current_price?: string | number | null;
}

interface TwilioCountryPricing {
  country?: string;
  iso_country?: string;
  price_unit?: string;
  outbound_sms_prices?: Array<{ carrier?: string; mcc?: string; mnc?: string; prices?: TwilioPrice[] }>;
}

/** Decimal currency string/number → integer micro-units, or null if unusable. */
function toMicros(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const micros = Math.round(n * 1_000_000);
  return Number.isSafeInteger(micros) ? micros : null;
}

function mapNumberType(raw: string | null | undefined): NormalizedRate["numberType"] {
  switch ((raw ?? "").toLowerCase()) {
    case "mobile":
    case "local":
      return "long_code";
    case "toll-free":
    case "toll_free":
    case "tollfree":
      return "toll_free";
    case "short-code":
    case "shortcode":
      return "short_code";
    default:
      return "unknown";
  }
}

export class TwilioRateAdapter implements ProviderRateAdapter {
  readonly provider = "twilio";

  configured(): boolean {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  }

  async ingest(query: RateQuery): Promise<NormalizedRate[]> {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    // Fail closed: no credentials → no rates, never invented ones.
    if (!sid || !token) {
      throw new Error("Twilio pricing is unavailable: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured.");
    }
    if (!/^[A-Z]{2}$/.test(query.country)) {
      throw new Error("RateQuery.country must be an ISO 3166-1 alpha-2 code.");
    }

    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(`${PRICING_BASE}/${query.country}`, {
      headers: { authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      throw new Error(`Twilio pricing request failed: HTTP ${res.status}.`);
    }
    const body = (await res.json()) as TwilioCountryPricing;
    const currency = (body.price_unit ?? "USD").toUpperCase();
    const fetchedAt = new Date();

    const rows: NormalizedRate[] = [];
    for (const group of body.outbound_sms_prices ?? []) {
      for (const p of group.prices ?? []) {
        const base = toMicros(p.base_price);
        if (base === null) continue; // never fabricate a missing base price
        rows.push({
          provider: this.provider,
          country: query.country,
          mcc: p.mcc ?? group.mcc ?? null,
          mnc: p.mnc ?? group.mnc ?? null,
          carrier: p.carrier ?? group.carrier ?? null,
          numberType: mapNumberType(p.number_type ?? query.numberType),
          direction: "outbound",
          basePriceMicros: base,
          currentPriceMicros: toMicros(p.current_price),
          carrierSurchargeMicros: null,
          currency,
          source: "twilio_pricing_api",
          effectiveAt: fetchedAt,
          fetchedAt,
          // Twilio prices don't carry an expiry; the ingest job sets a policy
          // freshness window when it persists. Default: one week.
          expiresAt: new Date(fetchedAt.getTime() + 7 * 24 * 3600 * 1000),
          rateVersion: fetchedAt.getTime(),
        });
      }
    }
    return rows;
  }
}
