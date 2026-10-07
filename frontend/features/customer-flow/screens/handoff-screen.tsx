"use client";

import { Check, ExternalLink } from "lucide-react";

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
 *
 * A check that draws itself, the thanks, a bar that says the review page is
 * on its way, and the link. The motion is the same for every rating too.
 */
export function HandoffScreen({
  businessName,
  destinationUrl,
  messages,
}: HandoffScreenProps) {
  return (
    <section className="flow-screen visit-handoff" data-flow-screen="handoff">
      <div className="visit-handoff__mark" aria-hidden="true">
        <Check size={30} strokeWidth={2.75} />
      </div>

      <h1 className="visit-handoff__heading" data-screen-heading tabIndex={-1}>
        {messages.thanksHeading}
      </h1>
      <p className="visit-handoff__sent">{messages.feedbackSent(businessName)}</p>

      <div className="visit-handoff__progress">
        <span className="visit-handoff__bar" aria-hidden="true" />
        <p className="visit-handoff__status" role="status">
          {messages.handoffBody}
        </p>
      </div>

      <CustomerActionBar>
        <a
          className={cn(
            buttonVariants({ variant: "action" }),
            "google-review-link visit-handoff__link",
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
