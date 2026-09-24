"use client";

import type { CSSProperties } from "react";
import { Star } from "lucide-react";

import type { CustomerMessages, RatingValue } from "@/lib/i18n/customer-messages";

const ratings: RatingValue[] = [1, 2, 3, 4, 5];

/**
 * Five stars as the customer sees them on the visit sheet.
 * Outline until chosen; gold only when filled. `--star-index` staggers the
 * fill left to right, and `data-busy` lets the unchosen stars step back while
 * the rating saves — owner preview is disabled too, but it is never busy.
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
    <fieldset
      className="visit-stars"
      disabled={disabled || preview}
      data-busy={disabled && !preview ? "" : undefined}
    >
      <legend className="sr-only">{messages.ratingGroup}</legend>
      <div className="visit-stars__row">
        {ratings.map((rating) => {
          const selected = value !== null && rating <= value;
          return (
            <span className="visit-star" key={rating}>
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
              <label
                className="visit-star__label"
                htmlFor={`visit-rating-${rating}`}
                data-filled={selected || undefined}
                style={{ "--star-index": rating - 1 } as CSSProperties}
              >
                <Star aria-hidden="true" strokeWidth={2} />
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
