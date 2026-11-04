import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AFTER_STEPS, HOW_IT_WORKS, PUBLIC_HERO, SETUP_STEPS, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";
import { publicPageMetadata } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata({
  path: "/how-it-works",
  title: "How it works",
  description:
    "Set up once: your Google link, your Tag, a plan, a test. Then every visit: they tap a star and are offered your Google review page, and you see the rating.",
});

/** The whole path: setting up once, every visit after, and what the owner does next. */
export default function HowItWorksPage() {
  return (
    <PublicArticle
      marketing
      currentPath="/how-it-works"
      breadcrumb="/how-it-works"
      title="How it works"
      lede="Set it up once. After that, every visit works the same way."
      actions={
        <>
          <Button asChild variant="action" className="w-auto">
            <Link href={START_HREF}>{PUBLIC_HERO.primary.label}</Link>
          </Button>
          <Link href="/product#customer-example" className="public-hero__sample-link">
            Try the customer example
          </Link>
        </>
      }
    >
      <Track eyebrow="Once" title="Setting up" steps={SETUP_STEPS} />
      <Track eyebrow="Every visit" title="At your counter" steps={HOW_IT_WORKS} />
      <Track eyebrow="Afterwards" title="On your phone" steps={AFTER_STEPS} />

      {/* This described a note field and rating-dependent routing, neither of
          which V1 has. The page takes a star and opens the same Google link for
          every rating — saying otherwise on the How it works page contradicts
          the Integrity page two clicks away. */}
      <p>
        You see every rating in Feedback, including the ones nobody would have
        told you about. The Google link is offered the same way whatever the
        rating was.
      </p>

      <section className="public-article__close">
        <h2>Start with one Tag.</h2>
        <p>Most of setting up is pasting your Google link. The rest is printing a code.</p>
        <div className="mt-6 max-w-xs">
          <Button asChild variant="action" size="lg">
            <Link href={START_HREF}>{PUBLIC_HERO.primary.label}</Link>
          </Button>
        </div>
      </section>
    </PublicArticle>
  );
}

function Track({
  eyebrow,
  title,
  steps,
}: {
  eyebrow: string;
  title: string;
  steps: ReadonlyArray<{ title: string; body: string }>;
}) {
  return (
    <section>
      <p className="public-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <ol className="public-flow mt-6">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="public-flow__number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3 className="text-lg font-semibold text-ink">{step.title}</h3>
              <p className="mt-2">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
