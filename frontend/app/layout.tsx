import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "ReviewBoost",
  description: "Share private feedback with a local business.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F5EF" },
    { media: "(prefers-color-scheme: dark)", color: "#101512" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <body className={GeistSans.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

