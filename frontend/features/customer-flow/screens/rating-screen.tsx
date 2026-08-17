"use client";

import { ShieldCheck } from "lucide-react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Textarea } from "@/components/ui/textarea";
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
  note: string;
  status: SubmissionStatus;
  onRatingChange: (rating: RatingValue) => void;
  onNoteChange: (note: string) => void;
  onSubmit: () => void;
}

export function RatingScreen({
  businessName,
  messages,
  rating,
  note,
  status,
  onRatingChange,
  onNoteChange,
  onSubmit,
}: RatingScreenProps) {
  const isSubmitting = status === "submitting";
  const isOffline = status === "offline";
  const hasError = status === "error";
  const noticeId = hasError || isOffline ? "feedback-status" : undefined;

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
          <div className="rating-note" data-rating-note>
            <label className="field-label" htmlFor="private-note">
              {messages.noteLabel}{" "}
              <span className="field-optional">({messages.optional})</span>
            </label>
            <Textarea
              id="private-note"
              name="private-note"
              maxLength={2000}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder={messages.notePlaceholder}
              disabled={isSubmitting}
              aria-describedby={
                noticeId ? `note-trust ${noticeId}` : "note-trust"
              }
            />
            <p className="trust-line" id="note-trust">
              <ShieldCheck aria-hidden="true" size={17} strokeWidth={2} />
              <span>{messages.noteTrust(businessName)}</span>
            </p>

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
