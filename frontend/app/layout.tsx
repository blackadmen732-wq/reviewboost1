import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import "@/styles/globals.css";

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
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <body className={GeistSans.className}>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
