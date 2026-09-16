import { LogoMark } from "@/components/brand/logo-mark";

/**
 * The ReviewBoost NFC card.
 *
 * A single dark, flat panel that anchors every scene in the programming sheet,
 * so the surface does not reshuffle underneath the owner between "hold it
 * there" and "done" — only the thing below it changes. It carries the real
 * mark, because this is one of the few moments the product is holding the
 * owner's full attention.
 *
 * The contactless arcs animate only while the phone is actually listening.
 * They are an instruction, not a progress bar: NFC reports no distance, so
 * nothing here may imply how close the Tag is or how far along a write is.
 */
export function NfcCard({ working, status }: { working: boolean; status: string }) {
  return (
    <div className="nfc-card" data-working={working ? "true" : "false"}>
      <div className="nfc-card__head">
        <LogoMark size={22} className="nfc-card__mark" />
        <div className="nfc-card__name">
          <span className="nfc-card__word">
            <span className="sr-only">ReviewBoost</span>
            <span aria-hidden="true">Review</span>
            <span aria-hidden="true" className="nfc-card__word-accent">
              Boost
            </span>
          </span>
          <span className="nfc-card__kind">NFC Tag</span>
        </div>
        <span className="nfc-card__status">{status}</span>
      </div>

      <div className="nfc-card__waves" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="72" height="72" fill="none">
          {/* Three arcs, smallest first, so the stagger reads as outward travel. */}
          {[14, 24, 34].map((radius, index) => (
            <path
              key={radius}
              className="nfc-card__wave"
              style={{ animationDelay: `${index * 0.18}s` }}
              d={`M ${32 - radius * 0.55} ${32 - radius * 0.83} A ${radius} ${radius} 0 0 1 ${32 - radius * 0.55} ${32 + radius * 0.83}`}
              transform="rotate(180 32 32)"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
