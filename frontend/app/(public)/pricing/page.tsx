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
 * never quote different plans. The prose underneath answers the questions a
 * card cannot — what a location is, how texts work, how to cancel.
 */
export default function PricingPage() {
  return (
    <PublicShell>
      <PricingSection as="h1" headline={PRICING.headline} lede={PRICING.lede} />

      <section
        aria-labelledby="how-we-charge"
        className="mx-auto w-full max-w-[40rem] px-5 pb-24 pt-16 sm:px-8 sm:pt-20"
      >
        <h2
          id="how-we-charge"
          className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink"
        >
          How we charge
        </h2>
        <div className="mt-6 flex flex-col gap-5 text-base leading-relaxed text-muted [&_p]:max-w-[52ch]">
          <p>
            A location is one place with its own Tags and its own Google review link.
            That is the unit we charge for — not a seat, not a scan.
          </p>
          <p>{PRICING.caveat}</p>
          <p>
            Texts are the monthly allowance included with a paid plan. They are added
            when each month is paid for and do not roll over, so an unusually quiet
            month does not bank credit against a busy one.
          </p>
          <p>
            Change plan or cancel from Billing in your account. Cancelling stops the
            next charge; your Tags keep working until the period you have paid for
            ends.
          </p>
        </div>
      </section>
    </PublicShell>
  );
}
