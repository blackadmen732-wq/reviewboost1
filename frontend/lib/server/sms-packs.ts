import "server-only";

/**
 * The text pack card: extra texts, bought once, never expiring.
 *
 * THE DATABASE IS THE AUTHORITY. `app.sms_pack_catalog` decides how many
 * segments a paid pack mints, and refuses to mint when Stripe collected any
 * other amount. This copy exists so the owner can be shown the card and the
 * checkout can be refused before Stripe is called; `sms-pack-billing.test.ts`
 * reads the migration and fails if the two disagree. Prices are integer
 * cents. See docs/MONEY.md §4.2.
 */

export const PACK_IDS = ["pack_50", "pack_200", "pack_500"] as const;
export type PackId = (typeof PACK_IDS)[number];

export interface SmsPack {
  id: PackId;
  segments: number;
  priceUsdCents: number;
}

export const SMS_PACKS: Record<PackId, SmsPack> = {
  pack_50: { id: "pack_50", segments: 50, priceUsdCents: 400 },
  pack_200: { id: "pack_200", segments: 200, priceUsdCents: 1600 },
  pack_500: { id: "pack_500", segments: 500, priceUsdCents: 4000 },
};

/** The card in display order, smallest first. */
export const SMS_PACK_LIST: readonly SmsPack[] = PACK_IDS.map((id) => SMS_PACKS[id]);

/** Stripe metadata that marks a Checkout Session or PaymentIntent as a pack. */
export const PACK_METADATA_KIND = "sms_pack";

export function isPackId(value: unknown): value is PackId {
  return typeof value === "string" && (PACK_IDS as readonly string[]).includes(value);
}
