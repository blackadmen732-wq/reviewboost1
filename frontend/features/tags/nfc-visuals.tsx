import type { NfcScene } from "@/lib/owner/nfc-presentation";

/**
 * The one figure at the centre of the programming sheet.
 *
 * Plain SVG and CSS rather than a library: it has to be on screen the instant
 * the sheet opens, and a spinner that arrives late is worse than none.
 *
 * Every scene draws on the same object — soft rings, a white disc, and inside
 * it the contactless symbol, a check, or a warning — so the sheet does not
 * reshuffle underneath the owner between "hold it there" and "ready". Only
 * the mark inside the disc changes.
 *
 * Nothing here measures anything. While writing, the arc around the disc turns
 * without ever filling: NFC reports no distance and no write progress, so any
 * figure that crept towards "full" would be invented.
 */
export function NfcFigure({ scene }: { scene: NfcScene }) {
  const mark = scene === "success" ? "check" : scene === "error" ? "alert" : "waves";

  return (
    <div className="nfc-figure" data-scene={scene} aria-hidden="true">
      {/* Keyed by the mark, so the entrance plays when the mark changes and
          not when the same symbol simply starts or stops working. */}
      <svg key={mark} viewBox="0 0 240 240" className="nfc-figure__svg" fill="none">
        <circle className="nfc-figure__ring nfc-figure__ring--outer" cx="120" cy="120" r="118" />
        <circle className="nfc-figure__ring nfc-figure__ring--inner" cx="120" cy="120" r="96" />
        <circle className="nfc-figure__disc" cx="120" cy="120" r="72" />

        {mark === "waves" ? (
          <>
            <circle className="nfc-figure__spinner" cx="120" cy="120" r="84" pathLength="100" />
            <g className="nfc-figure__waves" strokeLinecap="round">
              {/* Smallest first, so the stagger reads as travelling outward. */}
              {[16, 30, 44].map((radius) => (
                <path key={radius} className="nfc-figure__wave" d={arc(92, 120, radius, 52)} />
              ))}
            </g>
          </>
        ) : null}

        {mark === "check" ? (
          <>
            <g className="nfc-figure__particles">
              {PARTICLES.map(([x, y], index) => (
                <circle key={index} cx={x} cy={y} r={index % 2 === 0 ? 3.5 : 2.5} />
              ))}
            </g>
            <circle className="nfc-figure__check-ring" cx="120" cy="120" r="50" pathLength="100" />
            <path className="nfc-figure__tick" d="M98 121 L114 137 L144 106" pathLength="100" />
          </>
        ) : null}

        {mark === "alert" ? (
          <>
            <circle className="nfc-figure__alert-ring" cx="120" cy="120" r="50" />
            <path className="nfc-figure__alert-bar" d="M120 96 V126" />
            <circle className="nfc-figure__alert-dot" cx="120" cy="143" r="5" />
          </>
        ) : null}
      </svg>
    </div>
  );
}

/** An arc of `radius` around (cx, cy), `sweep` degrees either side of three o'clock. */
function arc(cx: number, cy: number, radius: number, sweep: number): string {
  const rad = (sweep * Math.PI) / 180;
  const x = cx + radius * Math.cos(rad);
  const y = radius * Math.sin(rad);
  return `M ${round(x)} ${round(cy - y)} A ${radius} ${radius} 0 0 1 ${round(x)} ${round(cy + y)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A few specks around the check. They appear once and fade; they never loop. */
const PARTICLES: ReadonlyArray<readonly [number, number]> = [
  [52, 78],
  [190, 70],
  [206, 150],
  [44, 168],
  [150, 206],
  [92, 34],
];
