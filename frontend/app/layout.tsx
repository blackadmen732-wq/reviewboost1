import type { Metadata, Viewport } from "next";
import {
  Anton,
  Bricolage_Grotesque,
  Cormorant_Garamond,
  Hanken_Grotesk,
  Kaushan_Script,
  Playfair_Display,
} from "next/font/google";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import { Toaster } from "@/components/ui/toast";
import "@/styles/globals.css";

/**
 * Hanken Grotesk carries everything a person reads and taps: body copy,
 * labels, controls, navigation, and the customer page's rating sheet.
 */
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

/** Display moments only. Never body copy, never a business's own identity. */
const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
  preload: false,
});

/*
 * The Look faces. Each one belongs to exactly one customer-page Look, so a
 * business's identity is set in type chosen for that business rather than in
 * ReviewBoost's own voice.
 *
 * None of them are preloaded. A customer page renders one Look, and the owner's
 * Look picker is the only screen that shows all six — paying six preloads on
 * every page to save one late swap on two screens is the wrong trade when the
 * stars must never wait for the hero.
 */
const kaushanScript = Kaushan_Script({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-look-signature",
  display: "swap",
  preload: false,
});

const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-look-bold",
  display: "swap",
  preload: false,
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-look-editorial",
  display: "swap",
  preload: false,
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-look-classic",
  display: "swap",
  preload: false,
});

const fontVariables = [
  hankenGrotesk.variable,
  bricolageGrotesque.variable,
  kaushanScript.variable,
  anton.variable,
  playfairDisplay.variable,
  cormorantGaramond.variable,
].join(" ");

export const metadata: Metadata = {
  // A template, so every page reads "Home — ReviewBoost" without each one
  // repeating the brand.
  title: { default: "ReviewBoost", template: "%s — ReviewBoost" },
  description: "Collect honest reviews for your local business.",
  applicationName: "ReviewBoost",
  // Next serves app/icon.tsx and app/apple-icon.tsx automatically; these point
  // at the exported files so a manifest or a third party has something stable.
  icons: {
    icon: [{ url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/brand/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  // Without this, an icon added to the iOS home screen still opens inside
  // Safari with the address bar and toolbar visible — which is the single most
  // obvious tell that it is a website. `statusBarStyle` lets our own header sit
  // under the status bar instead of beneath a grey band.
  appleWebApp: {
    capable: true,
    title: "ReviewBoost",
    statusBarStyle: "default",
  },
  // Phone numbers and addresses in feedback should not become blue links on
  // iOS; the formatting is unpredictable and it makes real content look broken.
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  // Painted behind the app while it launches, and behind the status bar in
  // standalone. Matched to the canvas so opening from the home screen does not
  // flash white before the first paint — the thing that most makes a PWA feel
  // like a browser rather than an app.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#14120F" },
  ],

};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/*
          iOS shows a white launch screen for a home-screen PWA unless a
          startup image matches the device exactly, and that list goes stale
          with every new iPhone. Painting the canvas colour on the document
          means the first frame is already cream — no device-specific assets to
          maintain, and no white flash in a demo.
        */}
        <style>{`html{background-color:#F8F5F0}@media (prefers-color-scheme:dark){html{background-color:#14120F}}`}</style>
      </head>
      <body className={hankenGrotesk.className}>
        <Providers>{children}</Providers>
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );
}
