import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PRICING, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Pricing",
  description: "One subscription per location. You will see the price before anything is charged.",
};

export default function PricingPage() {
  return (
    <PublicArticle title={PRICING.headline} lede={PRICING.lede}>
      <p>
        A location is one place with its own Tags and its own Google review link.
        That is the unit we charge for — not a seat, not a scan.
      </p>
      <p>{PRICING.caveat}</p>
      <p>
        When billing is live, the price will sit here in plain numbers. Until then
        we will not invent one.
      </p>
      <div className="mt-4 max-w-xs">
        <Button asChild variant="primary">
          <Link href={START_HREF}>Get started</Link>
        </Button>
      </div>
    </PublicArticle>
  );
}
