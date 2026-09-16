/**
 * The two figures the programming sheet draws below the card.
 *
 * Both are plain SVG with CSS animation rather than a library: they need to be
 * on screen the instant the sheet opens, and a spinner that arrives late is
 * worse than no spinner.
 */

/**
 * A phone, held. This is the "where do I put it" diagram, and it is the only
 * thing on screen while the read and write happen.
 *
 * Deliberately not a progress indicator. The Web NFC API reports nothing about
 * proximity or how far along a write is, so a bar or a percentage here would be
 * invented — and an invented progress bar that sits at 80% is how people
 * conclude software is broken.
 */
export function ReaderIndicator() {
  return (
    <div className="nfc-reader" aria-hidden="true">
      <span className="nfc-reader__halo" />
      <svg viewBox="0 0 48 72" width="48" height="72" fill="none">
        <rect
          x="2"
          y="2"
          width="44"
          height="68"
          rx="9"
          fill="var(--rb-surface)"
          stroke="currentColor"
          strokeWidth="3"
        />
        <rect x="17" y="8" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      </svg>
    </div>
  );
}

/**
 * The success check.
 *
 * Draws itself once, in the brand's action green — the same green every
 * confirming button in the product uses, so success looks like the rest of
 * ReviewBoost rather than like a system alert. Under reduced motion it simply
 * appears, already drawn.
 */
export function SuccessCheck() {
  return (
    <div className="nfc-check" aria-hidden="true">
      <svg viewBox="0 0 96 96" width="96" height="96" fill="none">
        <circle
          className="nfc-check__ring"
          cx="48"
          cy="48"
          r="42"
          stroke="currentColor"
          strokeWidth="6"
        />
        <path
          className="nfc-check__tick"
          d="M30 49.5 L42 61.5 L66 36"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
