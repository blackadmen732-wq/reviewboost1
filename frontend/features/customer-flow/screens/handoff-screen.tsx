"use client";

import { CircleCheck, ExternalLink } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { CustomerActionBar } from "@/features/customer-flow/customer-action-bar";
import { cn } from "@/lib/utils/cn";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface HandoffScreenProps {
  businessName: string;
  destinationUrl: string;
  messages: CustomerMessages;
}

/**
 * What the page shows while the browser is already on its way out.
 *
 * Every rating, one through five, reaches this screen and this destination.
 * Nothing here is derived from the rating — the value no longer exists in
 * state by the time this renders. The link is a fallback for a browser that
 * refused the programmatic navigation, and for a customer who came back with
 * the back button; it is not a step anyone has to take.
 */
export function HandoffScreen({
  businessName,
  destinationUrl,
  messages,
}: HandoffScreenProps) {
  return (
    <section className="flow-screen" data-flow-screen="handoff">
      <div className="success-mark" aria-hidden="true">
        <CircleCheck size={28} strokeWidth={2.1} />
      </div>
      <div className="screen-heading-group">
        <h1 className="customer-question" data-screen-heading tabIndex={-1}>
          {messages.thanksHeading}
        </h1>
        <p className="customer-support">
          {messages.feedbackSent(businessName)}
        </p>
      </div>

      <p className="customer-support" role="status">
        {messages.handoffBody}
      </p>

      <CustomerActionBar>
        <a
          className={cn(
            buttonVariants({ variant: "primary", size: "lg" }),
            "google-review-link",
          )}
          href={destinationUrl}
          rel="noopener noreferrer"
          data-destination-link
        >
          <span>{messages.openReviewPage}</span>
          <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
        </a>
      </CustomerActionBar>
    </section>
  );
}
