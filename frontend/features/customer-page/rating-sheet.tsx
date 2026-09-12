"use client";

import { Zap } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { StarRating } from "@/features/customer-page/star-rating";
import type { CustomerPageStatus } from "@/features/customer-page/customer-page-status";
import type { CustomerMessages, RatingValue } from "@/lib/i18n/customer-messages";

interface RatingSheetProps {
  messages: CustomerMessages;
  rating: RatingValue | null;
  status: CustomerPageStatus;
  onSelect: (rating: RatingValue) => void;
  onCommit?: (rating: RatingValue) => void;
  onRetry?: () => void;
}

/**
 * The white sheet, which belongs to ReviewBoost.
 *
 * Locked, deliberately. A business can change everything above this line and
 * nothing below it, so a customer who used one of these pages last month at a
 * different business recognises this half instantly and does not have to work
 * out what is being asked. That recognition is worth more to every business on
 * the platform than any single business would gain by restyling it.
 *
 * One question, one instruction, five stars, a small credit. The line between
 * the instruction and the stars is the only slot that ever changes, and
 * everything that can go wrong is written into it — so a failure never pushes the
 * stars off the screen or replaces the page the customer was looking at.
 */
export function RatingSheet({
  messages,
  rating,
  status,
  onSelect,
  onCommit,
  onRetry,
}: RatingSheetProps) {
  const failed = status === "failed" || status === "offline";
  const offline = status === "offline";

  return (
    <section className="cp-sheet" data-status={status}>
      <h1 className="cp-sheet__question">{messages.question}</h1>

      {failed ? (
        <p className="cp-sheet__alert" role="alert">
          <strong className="cp-sheet__alert-heading">
            {offline ? messages.offlineHeading : messages.saveFailedHeading}
          </strong>
          <span>{offline ? messages.offlineBody : messages.saveFailedBody}</span>
        </p>
      ) : (
        <p className="cp-sheet__instruction" role="status" aria-live="polite">
          {status === "opening"
            ? messages.opening
            : status === "saved"
              ? messages.ratingSaved
              : messages.tapInstruction}
        </p>
      )}

      <StarRating
        value={rating}
        messages={messages}
        onSelect={onSelect}
        {...(onCommit ? { onCommit } : {})}
        disabled={status === "loading" || status === "saving"}
      />

      {failed && onRetry ? (
        <button className="cp-sheet__retry" type="button" onClick={onRetry}>
          {messages.tryAgain}
        </button>
      ) : null}

      <footer className="cp-sheet__footer">
        <p className="cp-sheet__powered">
          <Zap className="cp-sheet__bolt" aria-hidden="true" strokeWidth={2.5} />
          <span>{messages.poweredByPrefix}</span>
          <Wordmark size="sm" tone="mono" className="cp-sheet__mark" />
        </p>
        <p className="cp-sheet__brandline" aria-hidden="true">
          {messages.brandLine}
        </p>
      </footer>
    </section>
  );
}
