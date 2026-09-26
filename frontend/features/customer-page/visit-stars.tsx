"use client";

import type { CustomerMessages, RatingValue } from "@/lib/i18n/customer-messages";

const ratings: RatingValue[] = [1, 2, 3, 4, 5];

/**
 * Five stars as the customer sees them on the visit card (Mario SoT).
 * Outline until chosen. Gold only when filled.
 */

export function VisitStars({
  value,
  onChange,
  messages,
  disabled = false,
  preview = false,
}: {
  value: RatingValue | null;
  onChange?: (rating: RatingValue) => void;
  messages: CustomerMessages;
  disabled?: boolean;
  preview?: boolean;
}) {
  return (
    <fieldset className="visit-stars" disabled={disabled || preview}>
      <legend className="sr-only">{messages.ratingGroup}</legend>
      <div className="visit-stars__row">
        {ratings.map((rating) => {
          const selected = value !== null && rating <= value;
          return (
            <span
              className="visit-star"
              key={rating}
              // Filling stars land left to right, a beat apart.
              style={{ "--star-index": rating - 1 } as React.CSSProperties}
            >
              <input
                className="visit-star__input"
                id={`visit-rating-${rating}`}
                name="visit-rating"
                type="radio"
                value={rating}
                checked={value === rating}
                disabled={disabled || preview}
                onChange={() => onChange?.(rating)}
                aria-label={messages.ratingSpoken[rating]}
              />
              <label className="visit-star__label" htmlFor={`visit-rating-${rating}`} data-filled={selected || undefined}>
                <VisitStar />
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A classic five-point star: sharp points, full arms, a fine outline. The
 * rounded icon-set star this replaces read as generic UI rather than as the
 * one thing on the page a customer is meant to touch.
 */
const STAR_PATH =
  "M12 1.7 L15.12 8.61 L22.65 9.44 L17.04 14.54 L18.58 21.96 L12 18.2 L5.42 21.96 L6.96 14.54 L1.35 9.44 L8.88 8.61 Z";

function VisitStar() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={STAR_PATH} strokeWidth={1.05} strokeLinejoin="round" stroke="currentColor" />
    </svg>
  );
}
