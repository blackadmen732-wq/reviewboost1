"use client";

import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface HandoffScreenProps {
  destinationUrl: string;
  messages: CustomerMessages;
  /** Back from the destination (back button, reload): offer the way at once. */
  returned: boolean;
}

/**
 * What the sheet holds while the browser is already opening the destination.
 *
 * Nothing to tap. The sheet keeps its place and its size; its words change to
 * "Thanks for sharing. / Opening Google…" (set on the shared visit card), and
 * where the stars were there is nothing — unless the page is still here a
 * few seconds later, or the customer came back with the back button. Then,
 * and only then, a quiet link: for a browser that did not follow, and for a
 * customer who wants to go again. It is never a step anyone has to take.
 *
 * Every rating, one through five, reaches this screen and this destination.
 * Nothing here is derived from the rating.
 */
export function HandoffScreen({ destinationUrl, messages, returned }: HandoffScreenProps) {
  return (
    <section className="flow-screen visit-handoff" data-flow-screen="handoff">
      <p className="visit-handoff__fallback" data-returned={returned || undefined}>
        <a
          className="google-review-link visit-handoff__link"
          href={destinationUrl}
          rel="noopener noreferrer"
          data-destination-link
        >
          {messages.openReviewPage}
        </a>
      </p>
    </section>
  );
}
