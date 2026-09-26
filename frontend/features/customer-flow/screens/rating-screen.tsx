"use client";

import { Button } from "@/components/ui/button";
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
  onRetry: () => void;
  /** Heading lives on the shared visit card so preview and live match. */
  embedInVisit?: boolean;
}

/**
 * One tap. Choosing a star submits it.
 *
 * There is no confirm step, because a confirm step is where a flow starts
 * deciding things about the customer. The only buttons that can appear here
 * are recovery from a failed submit — never a gate in front of one.
 */
export function RatingScreen({
  messages,
  rating,
  status,
  onRate,
  onRetry,
  embedInVisit = false,
}: RatingScreenProps) {
  const isSubmitting = status === "submitting";
  const isOffline = status === "offline";
  const hasError = status === "error";

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
        disabled={isSubmitting}
      />

      {/* Status lives in one short, centred line under the stars. The sheet has
          a fixed height, set by screen width, so the stars never move under a thumb; a
          boxed notice plus a large button did not fit in it, and the error
          was squeezed to a sliver the customer could not read. */}
      <div className="rating-actions" data-rating-actions>
        {isSubmitting ? (
          <p className="visit-status" role="status">
            {messages.sending}
          </p>
        ) : null}

        {hasError ? (
          <>
            <p id="feedback-status" className="visit-status visit-status--error" role="alert">
              <strong>{messages.submitErrorHeading}</strong> {messages.submitErrorBody}
            </p>
            <Button type="button" className="visit-retry" onClick={onRetry}>
              {messages.tryAgain}
            </Button>
          </>
        ) : null}

        {isOffline ? (
          <p id="feedback-status" className="visit-status" role="status">
            {messages.offline}
          </p>
        ) : null}
      </div>
    </section>
  );
}
