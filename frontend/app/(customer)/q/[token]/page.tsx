import type { Metadata } from "next";

import { CustomerFlow } from "@/features/customer-flow/customer-flow";

export const metadata: Metadata = {
  title: "Share feedback | ReviewBoost",
  robots: {
    index: false,
    follow: false,
  },
};

interface CustomerReviewPageProps {
  params: Promise<{ token: string }>;
}

export default async function CustomerReviewPage({ params }: CustomerReviewPageProps) {
  const { token } = await params;
  return <CustomerFlow key={token} token={token} />;
}

