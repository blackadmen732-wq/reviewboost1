import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { HOW_IT_WORKS, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Put a Tag where people pay. They scan and rate. Everyone is offered Google.",
};

export default function HowItWorksPage() {
  return (
    <PublicArticle
      marketing
      currentPath="/how-it-works"
      title="How it works"
      lede="From your counter to your Feedback, in three steps."
      actions={
        <>
          <Button asChild variant="action" className="w-auto">
            <Link href={START_HREF}>Get started</Link>
          </Button>
          <Link
            href="/product#customer-example"
            className="public-hero__sample-link"
          >
            Try the customer example
          </Link>
        </>
      }
    >
      <ol className="public-flow">
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.title}>
            <span className="public-flow__number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2>{step.title}</h2>
              <p className="mt-2">{step.body}</p>
            </div>
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
    </PublicArticle>
  );
}
