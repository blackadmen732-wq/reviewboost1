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
      <p>
        After they rate, you see the words they left. Low stars can open a private
        note so you can make it right. That note never replaces the Google link.
      </p>
      <div className="mt-4 max-w-xs">
        <Button asChild variant="primary">
          <Link href={START_HREF}>Get started</Link>
        </Button>
      </div>
    </PublicArticle>
  );
}
