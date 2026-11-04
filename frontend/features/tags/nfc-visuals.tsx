import { useId } from "react";

import { MARK_HEIGHT, MARK_PATHS, MARK_WIDTH } from "@/components/brand/mark-geometry";
import type { NfcScene } from "@/lib/owner/nfc-presentation";

/**
 * The picture at the centre of the "Set up tap" sheet: the owner's own Tag,
 * their phone coming up to it, and what happens between the two.
 *
 * Drawn like Apple's "Hold Near Reader": the object you hold, the object you
 * hold it to, and the waves between them, so nobody has to read a word to
 * know what to do. Every scene is the same drawing; only what moves changes,
 * so the sheet never reshuffles under the owner's thumb.
 *
 * - ready:    the phone waits below the Tag, breathing a little.
 * - writing:  the phone rises to the Tag and back while waves pulse (looking),
 *             then stays against it with a spinner on its screen (found).
 * - success:  the phone drops away, the Tag rings green, a check draws.
 * - error:    a red mark, and the phone shakes once.
 * - conflict, partial: an amber mark. Each needs the owner to decide.
 *
 * Colour follows DESIGN.md §3.3: blue while it works, green when it worked,
 * amber when it needs the owner, red when it failed. Nothing measures
 * anything: NFC reports no distance and no progress, so nothing here creeps
 * towards "done".
 *
 * Plain SVG and CSS (`styles/customer-page.css`), on screen the instant the
 * sheet opens. With reduced motion every scene is shown still and finished.
 */
export function NfcFigure({ scene, detected = false }: { scene: NfcScene; detected?: boolean }) {
  const id = useId().replace(/:/g, "");
  const mark =
    scene === "success" || scene === "partial"
      ? "check"
      : scene === "error" || scene === "conflict"
        ? "alert"
        : null;

  return (
    <div
      className="nfc-figure"
      data-scene={scene}
      data-detected={scene === "writing" && detected ? "" : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 300 380" className="nfc-figure__svg" fill="none">
        <defs>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0.58" className="nfc-figure__halo-stop" />
            <stop offset="1" className="nfc-figure__halo-stop" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e6e6ea" />
            <stop offset="0.3" stopColor="#9c9ca3" />
            <stop offset="0.52" stopColor="#f3f3f5" />
            <stop offset="0.76" stopColor="#8a8a91" />
            <stop offset="1" stopColor="#d6d6db" />
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#f1f1ef" />
          </linearGradient>
        </defs>

        <circle className="nfc-figure__halo" cx="150" cy="140" r="140" fill={`url(#${id}-halo)`} />

        {/* The Tag: the white card on the counter, as the owner knows it. */}
        <g className="nfc-figure__tag">
          <rect className="nfc-figure__tag-ring" x="56" y="16" width="188" height="124" rx="24" />
          <rect className="nfc-figure__tag-card" x="60" y="20" width="180" height="116" rx="20" />
          <svg x="76" y="36" width="34" height="32" viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}>
            {MARK_PATHS.map((d) => (
              <path key={d} d={d} fill="#00a86b" fillRule="evenodd" />
            ))}
          </svg>
          <QrModules x={138} y={34} size={88} />
          <g className="nfc-figure__tag-tap" stroke="#1a1a19" strokeWidth="2.2" strokeLinecap="round">
            <path d="M81 105.3a7.4 7.4 0 0 1 0 7.4" />
            <path d="M84.5 103.2a11.8 11.8 0 0 1 0 11.6" />
            <path d="M87.9 101.1a15.9 15.9 0 0 1 0 15.8" />
          </g>
        </g>

        {/* What passes between the phone and the Tag. */}
        <g className="nfc-figure__waves" strokeLinecap="round">
          <path className="nfc-figure__wave" d="M132 178 A 18 18 0 0 1 168 178" />
          <path className="nfc-figure__wave" d="M120 174 A 30 30 0 0 1 180 174" />
          <path className="nfc-figure__wave" d="M108 170 A 42 42 0 0 1 192 170" />
        </g>

        {/* The owner's phone, top edge first: that is where an iPhone reads. */}
        <g className="nfc-figure__phone">
          <rect x="98" y="168" width="104" height="204" rx="26" fill={`url(#${id}-metal)`} />
          <rect x="101" y="171" width="98" height="198" rx="23" fill="#0c0d10" />
          <rect x="106" y="176" width="88" height="188" rx="18" fill={`url(#${id}-glass)`} />
          <rect x="133" y="182" width="34" height="10" rx="5" fill="#0c0d10" />
          <svg x="133" y="254" width="34" height="32" viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}>
            {MARK_PATHS.map((d) => (
              <path key={d} d={d} fill="#00a86b" fillRule="evenodd" />
            ))}
          </svg>
          <circle className="nfc-figure__spinner-track" cx="150" cy="270" r="30" />
          <circle className="nfc-figure__spinner" cx="150" cy="270" r="30" pathLength="100" />
        </g>

        {/* The answer, over the Tag. */}
        <g className="nfc-figure__badge">
          <circle cx="150" cy="78" r="36" className="nfc-figure__badge-disc" />
          {mark === "check" ? (
            <path className="nfc-figure__check" d="M134 79 L145 90 L167 67" pathLength="100" />
          ) : null}
          {mark === "alert" ? (
            <>
              <path className="nfc-figure__alert" d="M150 62 V82" />
              <circle cx="150" cy="94" r="4.5" className="nfc-figure__alert-dot" />
            </>
          ) : null}
        </g>

        {scene === "success" ? (
          <g className="nfc-figure__sparks">
            {SPARKS.map(([dx, dy], index) => (
              <circle
                key={index}
                cx="150"
                cy="78"
                r={index % 2 === 0 ? 4.5 : 3.5}
                className={index % 2 === 0 ? "nfc-figure__spark" : "nfc-figure__spark nfc-figure__spark--gold"}
                style={{ "--dx": `${dx}px`, "--dy": `${dy}px` } as React.CSSProperties}
              />
            ))}
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/**
 * A QR code's look (three finder squares and a scatter of modules) — not a
 * readable code. The owner's real code is on the Tag page; a scannable one
 * here would be a second, wrong address.
 */
function QrModules({ x, y, size }: { x: number; y: number; size: number }) {
  const cell = size / 21;
  const finders: Array<[number, number]> = [
    [0, 0],
    [14, 0],
    [0, 14],
  ];
  return (
    <g fill="#1a1a19">
      {finders.map(([fx, fy]) => (
        <g key={`${fx}-${fy}`}>
          <rect x={x + fx * cell} y={y + fy * cell} width={7 * cell} height={7 * cell} rx={cell * 1.2} />
          <rect
            x={x + (fx + 1) * cell}
            y={y + (fy + 1) * cell}
            width={5 * cell}
            height={5 * cell}
            rx={cell * 0.8}
            fill="#ffffff"
          />
          <rect x={x + (fx + 2) * cell} y={y + (fy + 2) * cell} width={3 * cell} height={3 * cell} rx={cell * 0.5} />
        </g>
      ))}
      {MODULES.map(([mx, my]) => (
        <rect key={`${mx}-${my}`} x={x + mx * cell} y={y + my * cell} width={cell} height={cell} />
      ))}
    </g>
  );
}

/** A fixed scatter, so the picture is the same on every render and in every test. */
const MODULES: ReadonlyArray<readonly [number, number]> = [
  [8, 0], [10, 1], [12, 0], [9, 3], [11, 4], [8, 6], [12, 6], [10, 8],
  [0, 8], [2, 9], [4, 8], [6, 10], [1, 11], [3, 12], [5, 12],
  [8, 9], [9, 11], [11, 10], [13, 9], [15, 8], [17, 9], [19, 8], [20, 10],
  [14, 11], [16, 12], [18, 11], [20, 13], [8, 13], [10, 14], [12, 13],
  [9, 16], [11, 17], [8, 19], [10, 20], [12, 18], [14, 15], [16, 16],
  [18, 15], [20, 16], [15, 18], [17, 19], [19, 18], [14, 20], [18, 20], [20, 20],
];

/** Where each spark travels from the badge. They fly once and fade; nothing loops. */
const SPARKS: ReadonlyArray<readonly [number, number]> = [
  [-70, -36],
  [-44, -70],
  [0, -84],
  [46, -68],
  [72, -32],
  [-82, 12],
  [84, 14],
  [0, 46],
];
