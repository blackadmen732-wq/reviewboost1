"use client";

import type { FormEvent } from "react";

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
  businessName: string;
  messages: CustomerMessages;
  rating: RatingValue | null;
  status: SubmissionStatus;
  onRatingChange: (rating: RatingValue) => void;
  onSubmit: () => void;
}

export function RatingScreen({
  businessName: _businessName,
  messages,
  rating,
  status,
  onRatingChange,
  onSubmit,
}: RatingScreenProps) {
  const isSubmitting = status === "submitting";
  const isOffline = status === "offline";
  const hasError = status === "error";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating && !isSubmitting && !isOffline) onSubmit();
  }

  return (
    <section className="flow-screen" data-flow-screen="rating">
      <div className="screen-heading-group">
        <h1 className="customer-question" data-screen-heading tabIndex={-1}>
          {messages.ratingHeading}
        </h1>
        <p className="customer-support">{messages.ratingSupport}</p>
      </div>

      <form className="customer-form" onSubmit={handleSubmit}>
        <StarRating
          value={rating}
          onChange={onRatingChange}
          messages={messages}
          disabled={isSubmitting}
        />

        {rating ? (
          <div className="rating-actions" data-rating-actions>
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

            <CustomerActionBar>
              <Button
                type="submit"
                size="lg"
                loading={isSubmitting}
                loadingLabel={messages.sending}
                disabled={isOffline}
              >
                {hasError ? messages.tryAgain : messages.continue}
              </Button>
            </CustomerActionBar>
          </div>
        ) : null}
      </form>
    </section>
  );
}
