"use client";

import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface HandoffScreenProps {
  destinationUrl: string;
  messages: CustomerMessages;
}

/**
 * Not a step. The tap already sent the customer to the destination; this is
 * only seen by a customer who came back with the back button, or whose browser
 * did not leave. "Thanks for sharing." (on the shared card) and a plain link.
 *
 * Every rating, one through five, reaches this screen and this destination.
 * Nothing here is derived from the rating.
 */
export function HandoffScreen({ destinationUrl, messages }: HandoffScreenProps) {
  return (
    <section className="flow-screen visit-handoff" data-flow-screen="handoff">
      <a
        className="google-review-link visit-handoff__link"
        href={destinationUrl}
        rel="noopener noreferrer"
        data-destination-link
      >
        {messages.openReviewPage}
      </a>
    </section>
  );
}
