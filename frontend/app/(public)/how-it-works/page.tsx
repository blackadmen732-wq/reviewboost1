import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { HOW_IT_WORKS, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "How it works",
  description: "Put a Tag where people pay. They scan and rate. Everyone is offered Google.",
};

export default function HowItWorksPage() {
  return (
    <PublicArticle
      title="How it works"
      lede="Three steps. The rating never chooses who gets to leave a Google review."
    >
      <ol className="flex flex-col gap-10">
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.title}>
            <p className="text-sm font-medium text-muted">{String(index + 1).padStart(2, "0")}</p>
            <h2 className="!mt-2">{step.title}</h2>
            <p className="mt-2">{step.body}</p>
          </li>
        ))}
      </ol>
      {/* This described a note field and rating-dependent routing, neither of
          which V1 has. The page takes a star and opens the same Google link for
          every rating — saying otherwise on the How it works page contradicts
          the Integrity page two clicks away. */}
      <p>
        You see every rating in Feedback, including the ones nobody would have
        told you about. The Google link is offered the same way whatever the
        rating was.
      </p>
      <div className="mt-4 max-w-xs">
        <Button asChild variant="action">
          <Link href={START_HREF}>Get started</Link>
        </Button>
      </div>
    </PublicArticle>
  );
}
