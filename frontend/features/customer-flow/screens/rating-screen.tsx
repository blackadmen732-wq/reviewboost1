"use client";

import { VisitStars } from "@/features/customer-page/visit-stars";
import type { SubmissionStatus } from "@/features/customer-flow/customer-flow-state";
import type {
  CustomerMessages,
  RatingValue,
} from "@/lib/i18n/customer-messages";

interface RatingScreenProps {
  messages: CustomerMessages;
  rating: RatingValue | null;
  status: SubmissionStatus;
  onRate: (rating: RatingValue) => void;
  /** Heading lives on the shared visit card so preview and live match. */
  embedInVisit?: boolean;
}

/**
 * One tap. Choosing a star opens Google.
 *
 * There is no confirm step, because a confirm step is where a flow starts
 * deciding things about the customer — and there is no "Sending…", no error
 * and no Try again either: the page does not wait for the save, so there is
 * nothing to watch and nothing to retry. The one thing that can hold a
 * customer here is having no connection, which Google would need too.
 */
export function RatingScreen({
  messages,
  rating,
  status,
  onRate,
  embedInVisit = false,
}: RatingScreenProps) {
  return (
    <section className="flow-screen" data-flow-screen="rating">
      {embedInVisit ? null : (
        <div className="screen-heading-group">
          <h1 className="customer-question" data-screen-heading tabIndex={-1}>
            {messages.ratingHeading}
          </h1>
          <p className="customer-support">{messages.ratingSupport}</p>
        </div>
      )}

      <VisitStars
        value={rating}
        onChange={onRate}
        messages={messages}
        // The page is already on its way to Google: a second tap does nothing.
        disabled={status === "leaving"}
      />

      {/* One short, centred line under the stars, in the calm space above the
          footer, so the stars never move under a thumb. */}
      <div className="rating-actions" data-rating-actions>
        {status === "offline" ? (
          <p id="feedback-status" className="visit-status visit-status--offline" role="status">
            {messages.offline}
          </p>
        ) : null}
      </div>
    </section>
  );
}
