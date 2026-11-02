import localFont from "next/font/local";

/**
 * Public display typography; body/owner and customer fonts stay independent.
 *
 * Latin WOFF2 subsets of the upstream TTFs (see instrument-serif/README.md):
 * 22 KB each instead of 37 KB of compressed TTF.
 *
 * Not preloaded. The root 404 and error pages use the public shell, so a
 * preload here was hoisted onto every route — the sign-in page, the owner app
 * and the customer's rating page all downloaded a serif they never show. The
 * public headline asks for it as it renders; `swap` keeps the text readable
 * meanwhile and the fallback is metric-adjusted, so the headline does not jump.
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
  preload: false,
});
