"use client";

import type { CustomerMessages, RatingValue } from "@/lib/i18n/customer-messages";

const ratings: RatingValue[] = [1, 2, 3, 4, 5];

/** The fills every star shares. One page renders one set of stars. */
const GOLD_GRADIENT_ID = "rb-visit-star-gold";
const EMPTY_GRADIENT_ID = "rb-visit-star-empty";

/**
 * Five stars as the customer sees them on the visit card (Mario SoT).
 * Outline until chosen; a soft gold when filled, the same gold for every star.
 *
 * Each star is two layers: a soft, slightly raised empty star, and the gold
 * drawn over it. The gold is what animates in: the star under the thumb fills
 * first, and the fill runs back along the row to the first star, so the answer
 * starts where the customer touched. Every motion is on transform and opacity,
 * and under reduced motion the gold simply appears.
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
      <svg className="visit-stars__defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={GOLD_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe48c" />
            <stop offset="1" stopColor="#ffc83f" />
          </linearGradient>
          <linearGradient id={EMPTY_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#eceeed" />
          </linearGradient>
        </defs>
      </svg>
      <div className="visit-stars__row">
        {ratings.map((rating) => {
          const selected = value !== null && rating <= value;
          return (
            <span
              className="visit-star"
              key={rating}
              // Stars arrive left to right, a beat apart; once one is chosen,
              // the fill starts at it and runs back to the first.
              style={
                {
                  "--star-index": rating - 1,
                  "--fill-order": value === null ? 0 : Math.max(0, value - rating),
                } as React.CSSProperties
              }
            >
              <input
                className="visit-star__input"
                id={`visit-rating-${rating}`}
                name="visit-rating"
                type="radio"
                value={rating}
                checked={value === rating}
                disabled={disabled || preview}
                onChange={() => {
                  // A light tick where the phone can give one (Android); the
                  // same for every star.
                  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
                    try {
                      navigator.vibrate(10);
                    } catch {
                      // Some browsers expose vibrate and refuse it. Nothing to do.
                    }
                  }
                  onChange?.(rating);
                }}
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
 * A classic five-point star fitted to the approved reference pixel by pixel:
 * each vertex fitted to the reference's own star outline, a thin stroke, round joins. The
 * rounded icon-set star this replaces read as generic UI rather than as the
 * one thing on the page a customer is meant to touch.
 */
export const STAR_PATH =
  "M12 1.77 L15.22 8.74 L22.58 9.47 L17.1 14.7 L18.67 22.3 L12 18.56 L5.33 22.3 L6.9 14.7 L1.42 9.47 L8.78 8.74 Z";

function VisitStar() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g className="visit-star__body">
        <path
          className="visit-star__base"
          d={STAR_PATH}
          strokeWidth={0.62}
          strokeLinejoin="round"
          fill={`url(#${EMPTY_GRADIENT_ID})`}
        />
        <path
          className="visit-star__gold"
          d={STAR_PATH}
          strokeWidth={0.62}
          strokeLinejoin="round"
          fill={`url(#${GOLD_GRADIENT_ID})`}
        />
      </g>
    </svg>
  );
}
