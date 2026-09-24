"use client";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
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
 * deciding things about the customer. The only button that can appear here
 * is recovery from a failed submit — never a gate in front of one.
 *
 * The status line is always rendered, empty until a save is in flight, so it
 * holds its space under the stars and is a live region before it has anything
 * to say — "Sending…" appearing moves nothing and is announced when it does.
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

      <div className="rating-actions" data-rating-actions>
        {hasError || isOffline ? null : (
          <p
            className="visit-status"
            role="status"
            data-visible={isSubmitting || undefined}
          >
            {isSubmitting ? (
              <>
                <span className="visit-status__spinner" aria-hidden="true" />
                {messages.sending}
              </>
            ) : null}
          </p>
        )}

        {hasError ? (
          <div className="visit-retry">
            <InlineNotice
              id="feedback-status"
              kind="error"
              title={messages.submitErrorHeading}
              blocking
            >
              <p>{messages.submitErrorBody}</p>
            </InlineNotice>
            <Button
              type="button"
              className="visit-retry__button"
              onClick={onRetry}
            >
              {messages.tryAgain}
            </Button>
          </div>
        ) : null}

        {isOffline ? (
          <div className="visit-retry">
            <InlineNotice id="feedback-status" kind="offline">
              <p>{messages.offline}</p>
            </InlineNotice>
          </div>
        ) : null}
      </div>
    </section>
  );
}
