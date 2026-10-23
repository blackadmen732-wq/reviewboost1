import localFont from "next/font/local";

/**
 * Public display typography; body/owner and customer fonts stay independent.
 *
 * Latin WOFF2 subsets of the upstream TTFs (see instrument-serif/README.md).
 * Both are preloaded because the homepage headline uses both, and they load at
 * high priority beside the hero image: 22 KB each instead of 37 KB of
 * compressed TTF, so the image the page is measured by arrives sooner.
 */
export const publicEditorialFont = localFont({
  src: [
    {
      path: "./instrument-serif/InstrumentSerif-Regular-latin.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./instrument-serif/InstrumentSerif-Italic-latin.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-public-editorial",
  display: "swap",
});
