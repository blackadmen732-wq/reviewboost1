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
      <h2>The customer page</h2>
      <p>
        Preview opens the live page your customers already get. We do not restyle
        that page in setup — what you preview is what they see.
      </p>
      <div className="mt-4 max-w-xs">
        <Button asChild variant="primary">
          <Link href={START_HREF}>Get started</Link>
        </Button>
      </div>
    </PublicArticle>
  );
}
