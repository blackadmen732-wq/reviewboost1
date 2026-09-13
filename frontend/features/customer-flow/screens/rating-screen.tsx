"use client";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
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
  onRatingChange: (rating: RatingValue) => void;
  onRetry: () => void;
}

export function RatingScreen({
  messages,
  rating,
  status,
  onRatingChange,
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
        <p className="customer-support">
          {isSubmitting ? messages.openingGoogle : messages.ratingSupport}
        </p>
      </div>

      <StarRating
        value={rating}
        onChange={onRatingChange}
        messages={messages}
        disabled={isSubmitting}
      />

      {hasError ? (
        <div className="rating-note" data-rating-note>
          <InlineNotice
            id="feedback-status"
            kind="error"
            title={messages.submitErrorHeading}
            blocking
          >
            <p>{messages.submitErrorBody}</p>
          </InlineNotice>
          <Button
            size="lg"
            onClick={onRetry}
          >
            {messages.tryAgain}
          </Button>
        </div>
      ) : null}

      {isOffline ? (
        <div className="rating-note" data-rating-note>
          <InlineNotice id="feedback-status" kind="offline">
            <p>{messages.offline}</p>
          </InlineNotice>
        </div>
      ) : null}
    </section>
  );
}
