import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { INTEGRITY, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Integrity",
  description:
    "Every customer who rates one through five stars is offered the same chance to leave a Google review.",
};

export default function IntegrityPage() {
  return (
    <PublicArticle title={INTEGRITY.headline} lede={INTEGRITY.lede}>
      <p>{INTEGRITY.body}</p>
      <h2>What we help with</h2>
      <p>
        Asking every customer, the same way, and letting you read what they wrote.
        Happy visits are easier to turn into a public review because you asked.
        Unhappy visits show up as words you can act on.
      </p>
      <h2>What we do not do</h2>
      <p>
        We do not choose who reaches Google based on the stars. We do not hide
        the public review link after a low rating. We do not treat a missing
        public review as a win.
      </p>
      <div className="mt-4 max-w-xs">
        <Button asChild variant="action">
          <Link href={START_HREF}>Get started</Link>
        </Button>
      </div>
    </PublicArticle>
  );
}
