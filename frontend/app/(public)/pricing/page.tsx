import type { Metadata } from "next";

import { PRICING } from "@/features/public/public-copy";
import { PricingSection } from "@/features/public/pricing-table";
import { PublicShell } from "@/features/public/public-shell";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "$49, $79 or $129 a month. Starter starts with seven days free, card required; Growth and Pro are charged when you subscribe.",
};

/**
 * The pricing page: the dark price band first, then how we charge.
 *
 * The band is the same `PricingSection` the home page shows, so the two can
 * never quote different plans. The prose underneath answers what a card
 * cannot — what a location is, how texts work, how to cancel.
 */
export default function PricingPage() {
  return (
    <PublicShell>
      <PricingSection as="h1" headline={PRICING.headline} lede={PRICING.lede} />

      <section
        aria-labelledby="how-we-charge"
        className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24"
      >
        <div className="grid gap-10 md:grid-cols-12">
          <h2
            id="how-we-charge"
            className="text-[clamp(1.9rem,3.4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.03em] text-ink md:col-span-4"
          >
            How we charge
          </h2>
          <div className="flex flex-col gap-5 text-lg leading-relaxed text-muted md:col-span-7 md:col-start-6 [&_p]:max-w-[56ch]">
            <p>
              A location is one place with its own Tags and its own Google review link. That is
              the unit we charge for — not a seat, not a scan.
            </p>
            <p>{PRICING.caveat}</p>
            <p>
              Texts are the monthly allowance included with a paid plan. They are added when each
              month is paid for and do not roll over, so an unusually quiet month does not bank
              credit against a busy one.
            </p>
            <p>
              Change plan or cancel from Billing in your account. Cancelling stops the next charge;
              your Tags keep working until the period you have paid for ends.
            </p>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
