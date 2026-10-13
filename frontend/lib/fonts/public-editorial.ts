import localFont from "next/font/local";

/** Public display typography; body/owner and customer fonts stay independent. */
export const publicEditorialFont = localFont({
  src: [
    {
      path: "./instrument-serif/InstrumentSerif-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./instrument-serif/InstrumentSerif-Italic.ttf",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-public-editorial",
  display: "swap",
});
