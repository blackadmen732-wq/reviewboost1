"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { customerMessages } from "@/lib/i18n/customer-messages";

const noSubscription = () => () => {};

/**
 * What "Print this code" puts on paper, and all it puts there: the business,
 * the question the customer page asks, the code, large, and one line on how
 * to use it. Black on white whatever the screen's theme.
 *
 * Printing used to give the whole app page: the header, the tiles, the tab
 * bar, and in dark mode light text on white paper. Now, in print,
 * `styles/globals.css` hides everything in the body except this sheet, and on
 * screen the sheet is hidden. So the browser's own Print (⌘P) gives the same
 * paper as the button. Rendered into `<body>` itself, so nothing of the app
 * around it (a padded card, a max width) shapes the printed page.
 *
 * The question is the customer page's own heading, in English like the page
 * itself (every business is English until a language can be set), so the
 * paper and the page it opens say the same thing.
 *
 * At the foot, small and grey, which Tag this is. A business with several
 * Tags must put each sheet where its Tag belongs: a code in the wrong place
 * counts there, and with two places it opens the other place's page.
 */
export function PrintCodeSheet({
  src,
  businessName,
  tagName,
}: {
  /** The code image already on screen; it is loaded, so the paper never waits for it. */
  src: string;
  businessName?: string | undefined;
  tagName?: string | undefined;
}) {
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  if (!mounted) return null;

  return createPortal(
    <div className="print-code" data-print-code>
      {businessName ? <p className="print-code__business">{businessName}</p> : null}
      <p className="print-code__question">{customerMessages.en.ratingHeading}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="print-code__code" src={src} alt="" />
      <p className="print-code__hint">Scan with your phone’s camera</p>
      {tagName ? <p className="print-code__tag">{tagName}</p> : null}
    </div>,
    document.body,
  );
}
