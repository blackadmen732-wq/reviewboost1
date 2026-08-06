"use client";

import { Star } from "lucide-react";

import type { CustomerMessages, RatingValue } from "@/lib/i18n/customer-messages";

const ratings: RatingValue[] = [1, 2, 3, 4, 5];

interface StarRatingProps {
  value: RatingValue | null;
  onChange: (rating: RatingValue) => void;
  messages: CustomerMessages;
  disabled?: boolean;
}

export function StarRating({ value, onChange, messages, disabled = false }: StarRatingProps) {
  return (
    <fieldset className="star-rating" disabled={disabled}>
      <legend className="sr-only">{messages.ratingGroup}</legend>
      <div className="star-rating__options">
        {ratings.map((rating) => {
          const selected = value !== null && rating <= value;
          return (
            <span className="star-option" key={rating}>
              <input
                className="star-option__input sr-only"
                id={`rating-${rating}`}
                name="rating"
                type="radio"
                value={rating}
                checked={value === rating}
                onChange={() => onChange(rating)}
                aria-label={messages.ratingSpoken[rating]}
              />
              <label
                className="star-option__label"
                htmlFor={`rating-${rating}`}
                data-filled={selected || undefined}
              >
                <Star aria-hidden="true" size={34} strokeWidth={1.8} />
              </label>
            </span>
          );
        })}
      </div>
      <div className="star-rating__label" aria-live="polite" aria-atomic="true">
        {value ? messages.ratingLabels[value] : ""}
      </div>
    </fieldset>
  );
}

