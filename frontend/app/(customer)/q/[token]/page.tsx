import type { Metadata, Viewport } from "next";

import { CustomerPageClient } from "@/features/customer-page/customer-page-client";

export const metadata: Metadata = {
  title: "Rate your visit | ReviewBoost",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  // The top of this page is a photograph under a dark scrim, so the browser
  // chrome is tinted to match rather than to the cream app canvas. Locked to
  // light because the rating sheet is white for every business, in every theme.
  colorScheme: "light",
  themeColor: "#17130f",
};

interface CustomerReviewPageProps {
  params: Promise<{ token: string }>;
}

export default async function CustomerReviewPage({ params }: CustomerReviewPageProps) {
  const { token } = await params;
  return <CustomerPageClient key={token} token={token} />;
}
