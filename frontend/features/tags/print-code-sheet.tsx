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
 * While it is mounted it also takes the page's margin away, which leaves no
 * room for the address and date a browser prints along the edges. An
 * unnamed `@page`, here rather than in the stylesheet, so it holds only on a
 * page that prints this sheet: Safari never matches a named `@page`, and
 * applies `@page` margins from Safari 18.2 (older Safari keeps its own
 * margins, and the sheet still fits).
 *
 * The question is the customer page's own heading, in English like the page
 * itself (every business is English until a language can be set), so the
 * paper and the page it opens say the same thing.
 *
 * The foot names the place, for a business with more than one
 * (`lib/owner/printed-place.ts` says why). No Tag name: every Tag at one
 * place opens the same page.
 */
export function PrintCodeSheet({
  src,
  businessName,
  placeName,
}: {
  /** The code image already on screen; it is loaded, so the paper never waits for it. */
  src: string;
  businessName?: string | undefined;
  placeName?: string | undefined;
}) {
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  if (!mounted) return null;

  return createPortal(
    <div className="print-code" data-print-code>
      <style>{"@page { margin: 0; }"}</style>
      {businessName ? <p className="print-code__business">{businessName}</p> : null}
      <p className="print-code__question">{customerMessages.en.ratingHeading}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="print-code__code" src={src} alt="" />
      <p className="print-code__hint">Scan with your phone’s camera</p>
      {placeName ? <p className="print-code__place">{placeName}</p> : null}
    </div>,
    document.body,
  );
}
