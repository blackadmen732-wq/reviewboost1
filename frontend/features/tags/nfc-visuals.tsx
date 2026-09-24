import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";

/**
 * The figures the programming sheet draws above and within its stage.
 *
 * All plain SVG with CSS animation rather than a library: they need to be on
 * screen the instant the sheet opens, and a spinner that arrives late is
 * worse than no spinner.
 *
 * Composition follows the approved four-state reference (ready / writing /
 * success / error — one large centered glyph, a soft halo behind it, an arc
 * only while genuinely working). The reference's blue is not ours: every
 * glyph here uses the real brand green (`--rb-brand`) or the product's
 * existing danger token, and the mark at the top is the real, approved
 * `ReviewBoostLogo` asset, not a redrawn icon.
 */

/**
 * The wordmark that sits above the stage, replacing the old dark wallet card.
 * Plain background, centered — this is one of the few moments the product is
 * holding the owner's full attention, so it carries the real mark rather than
 * a status readout.
 */
export function NfcHeader() {
  return (
    <div className="nfc-header">
      <ReviewBoostLogo pose="full" size="nav" />
    </div>
  );
}

/**
 * The large centered NFC glyph for the ready and writing scenes.
 *
 * Deliberately not a progress indicator even while `active`. The Web NFC API
 * reports nothing about proximity or how far along a write is, so a bar or a
 * percentage here would be invented — and an invented progress bar that sits
 * at 80% is how people conclude software is broken. The rotating arc shown
 * while `active` says only "working", never "how much."
 */
export function ReaderIndicator({ active = false }: { active?: boolean }) {
  return (
    <div className="nfc-glyph" data-active={active ? "true" : "false"} aria-hidden="true">
      <span className="nfc-glyph__glow" />
      <span className="nfc-glyph__ring" />
      {active ? <span className="nfc-glyph__arc" /> : null}
      <svg className="nfc-glyph__icon" viewBox="0 0 64 64" width="44" height="44" fill="none">
        {[10, 18, 26].map((radius, index) => (
          <path
            key={radius}
            style={{ animationDelay: `${index * 0.18}s` }}
            className={active ? "nfc-glyph__wave" : undefined}
            d={`M ${32 - radius * 0.55} ${32 - radius * 0.83} A ${radius} ${radius} 0 0 1 ${32 - radius * 0.55} ${32 + radius * 0.83}`}
            transform="rotate(180 32 32)"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
        ))}
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
    <div className="nfc-glyph nfc-glyph--success" aria-hidden="true">
      <span className="nfc-glyph__glow" />
      <svg viewBox="0 0 96 96" width="72" height="72" fill="none">
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

/**
 * The error glyph for a Tag that could not be read.
 *
 * Same centered composition as the reader and the check, so the four states
 * read as one family rather than three good screens and an alert box. Uses
 * the product's existing danger token rather than an invented red.
 */
export function ErrorGlyph() {
  return (
    <div className="nfc-glyph nfc-glyph--error" aria-hidden="true">
      <span className="nfc-glyph__glow" />
      <svg viewBox="0 0 96 96" width="72" height="72" fill="none">
        <circle cx="48" cy="48" r="42" stroke="currentColor" strokeWidth="6" />
        <line x1="48" y1="30" x2="48" y2="56" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        <circle cx="48" cy="68" r="3.5" fill="currentColor" />
      </svg>
    </div>
  );
}
