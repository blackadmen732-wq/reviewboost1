import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PRODUCT, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Product",
  description: "A Tag is a printed code or a programmed NFC tag. Same customer page either way.",
};

export default function ProductPage() {
  return (
    <PublicArticle title="Tags" lede={PRODUCT.lede}>
      <p>{PRODUCT.headline} Setup creates your first one. You can add more later from Tags.</p>
      {PRODUCT.items.map((item) => (
        <div key={item.title}>
          <h2>{item.title}</h2>
          <p className="mt-2">{item.body}</p>
        </div>
      ))}
      <h2>Both carry the same link</h2>
      <p>
        The QR code and the NFC chip hold one address, and it belongs to
        ReviewBoost — never to Google. That indirection is the whole design:
        every rating is recorded before anyone is handed on, and the destination
        can change without the code changing.
      </p>

      <h2>What breaks a code, and what does not</h2>
      <p>
        Changing your Google link does not. Rename the business, move the
        listing, point somewhere else entirely — the Tag on the counter is
        untouched, because it was never pointing at Google in the first place.
      </p>
      <p>
        Rotating a Tag&apos;s code does, and that is what it is for. Rotation
        issues a new address and retires the old one, so anything already printed
        or programmed stops working. Use it when a code has ended up somewhere it
        should not be; print the replacement before you retire the original.
      </p>

      <h2>The customer page</h2>
      <p>
        Preview opens the live page your customers already get. We do not restyle
        that page in setup — what you preview is what they see.
      </p>
      <div className="mt-4 max-w-xs">
        <Button asChild variant="action">
          <Link href={START_HREF}>Get started</Link>
        </Button>
      </div>
    </PublicArticle>
  );
}
