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
  onRate: (rating: RatingValue) => void;
  onRetry: () => void;
}

export function RatingScreen({
  businessName,
  messages,
  rating,
  status,
  onRate,
  onRetry,
}: RatingScreenProps) {
  const isSubmitting = status === "submitting";
  const isOffline = status === "offline";
  const hasError = status === "error";
  const noticeId = hasError || isOffline ? "feedback-status" : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating && (hasError || isOffline) && !isSubmitting) onRetry();
  }

  return (
    <section className="flow-screen" data-flow-screen="rating">
      <div className="screen-heading-group">
        <h1 className="customer-question" data-screen-heading tabIndex={-1}>
          {messages.ratingHeading}
        </h1>
        <p className="customer-support customer-support--kicker">
          {isSubmitting ? messages.sending : messages.ratingSupport}
        </p>
      </div>

      <form className="customer-form" onSubmit={handleSubmit}>
        <StarRating
          value={rating}
          onChange={onRate}
          messages={messages}
          disabled={isSubmitting}
        />

        <p className="sr-only">{messages.noteTrust(businessName)}</p>

        {hasError ? (
          <div data-rating-note>
            <InlineNotice
              id="feedback-status"
              kind="error"
              title={messages.submitErrorHeading}
              blocking
            >
              <p>{messages.submitErrorBody}</p>
            </InlineNotice>
            <CustomerActionBar>
              <Button
                type="submit"
                size="lg"
                loading={isSubmitting}
                loadingLabel={messages.sending}
              >
                {messages.tryAgain}
              </Button>
            </CustomerActionBar>
          </div>
        ) : null}

        {isOffline ? (
          <div data-rating-note>
            <InlineNotice id={noticeId} kind="offline">
              <p>{messages.offline}</p>
            </InlineNotice>
          </div>
        ) : null}
      </form>
    </section>
  );
}
