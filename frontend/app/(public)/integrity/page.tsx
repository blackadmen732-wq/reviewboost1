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
    <PublicArticle
      currentPath="/integrity"
      title={INTEGRITY.headline}
      lede={INTEGRITY.lede}
    >
      <p>{INTEGRITY.body}</p>
      <h2>What we help with</h2>
      {/* This said customers leave words you can read and act on. V1 takes a
          star and nothing else — no note field — so the page arguing for the
          product's honesty was itself describing something that does not
          exist. */}
      <p>
        Asking every customer, the same way, at the moment they are still
        standing there. Most people who leave happy never think to post
        anything; being asked is the whole difference.
      </p>
      <p>
        You see every rating, including the quiet ones. A run of three stars on
        Tuesday afternoons is something you can act on, and it is not something
        anybody would have walked over to tell you.
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
