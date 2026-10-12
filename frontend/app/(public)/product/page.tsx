import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PRODUCT, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";
import { ProductDemo } from "@/features/public/product-demo";

export const metadata: Metadata = {
  title: "Product",
  description: "A Tag is a printed code or a programmed NFC tag. Same customer page either way.",
};

export default function ProductPage() {
  return (
    <PublicArticle title="Tags" lede={PRODUCT.lede} media={<ProductDemo />}>
      <p>{PRODUCT.headline} Setup creates your first one. You can add more later from Tags.</p>
      {PRODUCT.items.map((item) => (
        <div key={item.title}>
          <h2>{item.title}</h2>
          <p className="mt-2">{item.body}</p>
        </div>
      ))}
      <h2>Both carry the same link</h2>
      <p>
        The QR code and the NFC chip open your ReviewBoost page, never to Google
        directly. Customers tap a star, then get your Google review link. Every
        rating is kept in your Feedback.
      </p>

      <h2>What breaks a code, and what does not</h2>
      <p>
        Changing your Google link does not break your Tag. If your Google
        listing changes, update its review link in Settings. Your printed code
        and NFC tag still work.
      </p>
      <p>
        Rotating a Tag&apos;s code does, and that is what it is for. Rotation
        issues a new address and retires the old one, so anything already printed
        or programmed stops working. Use it when a code has ended up somewhere it
        should not be. Once you rotate, print the new code and rewrite the NFC
        tag before putting it back in use.
      </p>

      <h2>The customer page</h2>
      <p>
        Your business photo appears above the rating card. Add it in Customer
        page, check the preview, then publish. Use Preview customer page to open
        the page your customers get.
      </p>
      <div className="mt-4 max-w-xs">
        <Button asChild variant="action">
          <Link href={START_HREF}>Get started</Link>
        </Button>
      </div>
    </PublicArticle>
  );
}
