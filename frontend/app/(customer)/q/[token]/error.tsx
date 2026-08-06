"use client";

import { useState } from "react";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { customerMessages } from "@/lib/i18n/customer-messages";
import type { Locale } from "@/lib/i18n/config";

export default function CustomerReviewError({ reset }: { reset: () => void }) {
  const [locale, setLocale] = useState<Locale>("en");
  return (
    <CustomerBlockingState
      kind="error"
      locale={locale}
      messages={customerMessages[locale]}
      onLocaleChange={setLocale}
      onRetry={reset}
    />
  );
}
