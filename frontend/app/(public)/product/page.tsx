import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PRODUCT, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";
import { ProductDemo } from "@/features/public/product-demo";

export const metadata: Metadata = {
  title: "Product",
  description:
    "A Tag is a printed code or a programmed NFC tag. Same customer page either way.",
};

export default function ProductPage() {
  return (
    <PublicArticle
      marketing
      currentPath="/product"
      title="Tags"
      lede={PRODUCT.lede}
      media={<ProductDemo hero />}
      actions={
        <>
          <Button asChild variant="action" className="w-auto">
            <Link href={START_HREF}>Get started</Link>
          </Button>
          <Link href="/pricing" className="public-hero__sample-link">
            View pricing
          </Link>
        </>
      }
    >
      <p>
        {PRODUCT.headline} Setup creates your first one. You can add more later
        from Tags.
      </p>
      <div className="public-product-options">
        {PRODUCT.items.map((item) => (
          <section key={item.title}>
            <h2>{item.title}</h2>
            <p className="mt-2">{item.body}</p>
          </section>
        ))}
      </div>
      <section>
        <h2>Both carry the same link</h2>
        <p>
          The QR code and the NFC chip open your ReviewBoost page, never to
          Google directly. Customers tap a star, then get your Google review
          link. Every rating is kept in your Feedback.
        </p>
      </section>
      <section>
        <h2>The customer page</h2>
        <p>
          Your business photo appears above the rating card. Add it in Customer
          page, check the preview, then publish. Use Preview customer page to
          open the page your customers get.
        </p>
      </section>
      <details className="public-product-details">
        <summary>What breaks a code, and what does not</summary>
        <div>
          <p>
            Changing your Google link does not break your Tag. If your Google
            listing changes, update its review link in Settings. Your printed
            code and NFC tag still work.
          </p>
          <p>
            Rotating a Tag&apos;s code does, and that is what it is for.
            Rotation issues a new address and retires the old one, so anything
            already printed or programmed stops working. Use it when a code has
            ended up somewhere it should not be. Once you rotate, print the new
            code and rewrite the NFC tag before putting it back in use.
          </p>
        </div>
      </details>
    </PublicArticle>
  );
}
