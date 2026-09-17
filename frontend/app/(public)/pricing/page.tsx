import type { Metadata } from "next";

import { PRICING } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";
import { PricingTable } from "@/features/public/pricing-table";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Seven days free, then $49, $79 or $129 a month. A card is required to start and nothing is charged until the trial ends.",
};

export default function PricingPage() {
  return (
    <PublicArticle title={PRICING.headline} lede={PRICING.lede}>
      <p>
        A location is one place with its own Tags and its own Google review link.
        That is the unit we charge for — not a seat, not a scan.
      </p>

      {/* This page used to say "When billing is live, the price will sit here in
          plain numbers. Until then we will not invent one." That was honest when
          it was written. Billing shipped, and the sentence outlived it — leaving
          the pricing page as the one page that could not answer the question it
          exists to answer. */}
      <div className="not-prose mt-8">
        <PricingTable />
      </div>

      <p className="mt-10">
        Texts are the monthly allowance included with a paid plan. They are added
        when each month is paid for and do not roll over, so an unusually quiet
        month does not bank credit against a busy one.
      </p>
      <p>
        Change plan or cancel from Billing in your account. Cancelling stops the
        next charge; your Tags keep working until the period you have paid for
        ends.
      </p>
    </PublicArticle>
  );
}
