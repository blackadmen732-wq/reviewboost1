"use client";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { CustomerActionBar } from "@/features/customer-flow/customer-action-bar";
import { StarRating } from "@/features/customer-flow/star-rating";
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
}: RatingScreenProps) {
  const isSubmitting = status === "submitting";
  const isOffline = status === "offline";
  const hasError = status === "error";

  return (
    <section className="flow-screen" data-flow-screen="rating">
      <div className="screen-heading-group">
        <h1 className="customer-question" data-screen-heading tabIndex={-1}>
          {messages.ratingHeading}
        </h1>
        <p className="customer-support">{messages.ratingSupport}</p>
      </div>

      <StarRating
        value={rating}
        onChange={onRate}
        messages={messages}
        disabled={isSubmitting}
      />

      <div className="rating-actions" data-rating-actions>
        {isSubmitting ? (
          <p className="customer-support" role="status">
            {messages.sending}
          </p>
        ) : null}

        {hasError ? (
          <InlineNotice
            id="feedback-status"
            kind="error"
            title={messages.submitErrorHeading}
            blocking
          >
            <p>{messages.submitErrorBody}</p>
          </InlineNotice>
        ) : null}

        {isOffline ? (
          <InlineNotice id="feedback-status" kind="offline">
            <p>{messages.offline}</p>
          </InlineNotice>
        ) : null}

        {hasError ? (
          <CustomerActionBar>
            <Button type="button" size="lg" onClick={onRetry}>
              {messages.tryAgain}
            </Button>
          </CustomerActionBar>
        ) : null}
      </div>
    </section>
  );
}
