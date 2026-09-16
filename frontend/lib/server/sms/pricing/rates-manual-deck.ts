import "server-only";

import type {
  NormalizedRate,
  ProviderRateAdapter,
  RateQuery,
} from "@/lib/server/sms/pricing/rates";

/**
 * Versioned manual / imported rate-deck adapter.
 *
 * For a provider without a usable authenticated pricing API in this environment,
 * prices come from a *deck* — a versioned set of normalized rates a human
 * imported from the provider's published pricing, tagged with `source:
 * "manual_deck"` and a `rateVersion`. This is not fake pricing: it is real
 * published pricing, recorded deliberately, auditable by its version, and
 * distinguishable at a glance from an API-sourced rate.
 *
 * The adapter only ever serves rows it was given; it never synthesises a price
 * for a key the deck does not cover — an uncovered lookup returns nothing, and
 * the router treats "no rate" as "no route", failing closed.
 */
export class ManualDeckRateAdapter implements ProviderRateAdapter {
  readonly provider: string;
  private readonly deck: NormalizedRate[];

  constructor(provider: string, deck: NormalizedRate[]) {
    this.provider = provider;
    // Defensive copy; every row must belong to this provider and be manual-deck.
    this.deck = deck.map((r) => {
      if (r.provider !== provider) {
        throw new Error(`Deck row provider ${r.provider} does not match adapter provider ${provider}.`);
      }
      if (r.source !== "manual_deck") {
        throw new Error("ManualDeckRateAdapter only accepts rows with source 'manual_deck'.");
      }
      return { ...r };
    });
  }

  configured(): boolean {
    return this.deck.length > 0;
  }

  async ingest(query: RateQuery): Promise<NormalizedRate[]> {
    if (this.deck.length === 0) {
      throw new Error(`No imported rate deck loaded for provider ${this.provider}.`);
    }
    // Serve the covered rows for this destination; highest rateVersion wins per
    // (country, mcc, mnc, numberType, direction) so a re-import supersedes cleanly.
    const matches = this.deck.filter(
      (r) =>
        r.country === query.country &&
        r.direction === query.direction &&
        (query.mcc == null || r.mcc == null || r.mcc === query.mcc) &&
        (query.mnc == null || r.mnc == null || r.mnc === query.mnc),
    );
    const bestByKey = new Map<string, NormalizedRate>();
    for (const r of matches) {
      const key = `${r.country}|${r.mcc ?? ""}|${r.mnc ?? ""}|${r.numberType}|${r.direction}`;
      const cur = bestByKey.get(key);
      if (!cur || r.rateVersion > cur.rateVersion) bestByKey.set(key, r);
    }
    return [...bestByKey.values()];
  }
}
