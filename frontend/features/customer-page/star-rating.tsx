"use client";

import { useRef } from "react";

import { Star } from "lucide-react";

import type { CustomerMessages, RatingValue } from "@/lib/i18n/customer-messages";

const ratings: readonly RatingValue[] = [1, 2, 3, 4, 5];

interface StarRatingProps {
  value: RatingValue | null;
  messages: CustomerMessages;
  /** Paint the selection. Called for every change, including arrow keys. */
  onSelect: (rating: RatingValue) => void;
  /**
   * Commit the rating: save it and hand off to Google. Omitted in preview, where
   * the stars fill but nothing is recorded.
   */
  onCommit?: (rating: RatingValue) => void;
  disabled?: boolean;
}

/**
 * Five stars, and nothing around them.
 *
 * No boxes, no cards, no tiles. A star with a border drawn around it stops
 * reading as a star and starts reading as a button that happens to have a star
 * on it, and the whole page is built so that a person who has never heard of
 * ReviewBoost knows what to do without reading anything. The tap target is much
 * larger than the glyph and completely invisible.
 *
 * Real radio inputs underneath. That is what buys keyboard support, arrow-key
 * movement, correct announcements, and the browser's own grouping semantics for
 * free — a `div` with `role="radiogroup"` and hand-written key handling would
 * reimplement all of it and get some of it wrong.
 *
 * SELECTING AND COMMITTING ARE SEPARATE, AND ONLY FOR THE KEYBOARD
 * ---------------------------------------------------------------
 * A tap is the decision — nobody taps a star to browse — so a tap fills the
 * stars and commits in one gesture.
 *
 * A keyboard is different. Arrow keys move *and* select on a radio group, so a
 * keyboard user exploring the row would be sent to Google by the first arrow
 * press with no way back. So an arrow only fills the stars, and Space or Enter
 * commits — the same two keys that already activate the control they are on. No
 * step is added for anyone: the pointer path is still one gesture.
 *
 * Telling those apart takes more than picking the right handler. On a radio,
 * `click` fires before `input` and `change` — and Chromium fires a full `click`
 * for arrow-key navigation too, so "commit on click" alone would hand a keyboard
 * user straight to Google on their first arrow. A keyboard-generated click is
 * distinguishable by `detail === 0`, so the commit needs both: a click, and
 * evidence it came from a pointer or from a key that means "activate".
 */
const activationKeys = new Set([" ", "Spacebar", "Enter"]);

export function StarRating({
  value,
  messages,
  onSelect,
  onCommit,
  disabled = false,
}: StarRatingProps) {
  const lastKey = useRef<string | null>(null);

  function commit(rating: RatingValue) {
    if (!onCommit) return;
    // Supported on Android Chrome, absent on iOS Safari. A rating that feels
    // physical is worth the two lines; nothing depends on it existing.
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(8);
    }
    onCommit(rating);
  }

  // A fieldset alone announces as a plain group; the explicit role is what makes
  // a screen reader say "1 of 5" as the customer moves along the row.
  return (
    <fieldset className="cp-stars" role="radiogroup" disabled={disabled}>
      <legend className="sr-only">{messages.ratingGroup}</legend>
      <div className="cp-stars__row">
        {ratings.map((rating) => {
          const filled = value !== null && rating <= value;
          return (
            <span className="cp-star" key={rating}>
              <input
                className="cp-star__input"
                id={`cp-rating-${rating}`}
                name="cp-rating"
                type="radio"
                value={rating}
                checked={value === rating}
                onChange={() => onSelect(rating)}
                onClick={(event) => {
                  const key = lastKey.current;
                  lastKey.current = null;
                  const fromPointer = event.detail > 0;
                  if (fromPointer || (key !== null && activationKeys.has(key))) {
                    commit(rating);
                  }
                }}
                onKeyDown={(event) => {
                  lastKey.current = event.key;
                  // Enter does not activate a radio on its own, so it has to be
                  // handled here; Space arrives as a click and is handled there.
                  if (event.key === "Enter") {
                    lastKey.current = null;
                    commit(rating);
                  }
                }}
                aria-label={messages.ratingSpoken[rating]}
              />
              <label className="cp-star__label" htmlFor={`cp-rating-${rating}`}>
                <Star
                  className="cp-star__glyph"
                  data-filled={filled || undefined}
                  aria-hidden="true"
                  strokeWidth={1.5}
                />
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
