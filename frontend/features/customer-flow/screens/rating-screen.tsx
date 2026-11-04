"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { VisitStars } from "@/features/customer-page/visit-stars";
import type { SubmissionStatus } from "@/features/customer-flow/customer-flow-state";
import type {
  CustomerMessages,
  RatingValue,
} from "@/lib/i18n/customer-messages";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";

interface RatingScreenProps {
  messages: CustomerMessages;
  rating: RatingValue | null;
  status: SubmissionStatus;
  onRate: (rating: RatingValue) => void;
  onRetry: () => void;
  /** Heading lives on the shared visit card so preview and live match. */
  embedInVisit?: boolean;
  /** One line under the stars when nothing else is said there (a preview). */
  note?: ReactNode;
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
  note = null,
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

        {hasError ? <SubmitFailed messages={messages} onRetry={onRetry} /> : null}

        {isOffline ? (
          <p id="feedback-status" className="visit-status visit-status--offline" role="status">
            {messages.offline}
          </p>
        ) : null}

        {!isSubmitting && !hasError && !isOffline ? note : null}
      </div>
    </section>
  );
}

/**
 * The rating did not save. It is sent again by itself (3 s, 10 s, 30 s, or
 * when the phone is back online), with the same key, so it is never counted
 * twice; "Try now" skips the wait. Each failure remakes this line, and the
 * count of tries carries on under one key.
 */
function SubmitFailed({
  messages,
  onRetry,
}: {
  messages: CustomerMessages;
  onRetry: () => void;
}) {
  const retry = useAutoRetry({ key: "rating-submit", failure: null, onRetry });
  return (
    <>
      <p id="feedback-status" className="visit-status visit-status--error" role="alert">
        <strong>{messages.submitErrorHeading}</strong>{" "}
        {retry.phase === "waiting" ? (
          // An alert: a number changing every second would be read out every
          // second, so a screen reader hears one sentence.
          <>
            <span aria-hidden="true">{messages.submitRetryingIn(retry.secondsLeft)}</span>
            <span className="sr-only">{messages.submitRetryingSoon}</span>
          </>
        ) : retry.phase === "offline" ? (
          messages.offline
        ) : (
          messages.submitErrorBody
        )}
      </p>
      <Button
        type="button"
        variant="action"
        size="lg"
        className="visit-retry"
        onClick={retry.retryNow}
      >
        {retry.phase === "stopped" ? messages.tryAgain : messages.tryNow}
      </Button>
    </>
  );
}
