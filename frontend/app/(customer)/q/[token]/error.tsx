"use client";

import { useState } from "react";

import { CustomerPageFallback } from "@/features/customer-page/customer-page-fallback";
import { customerMessages } from "@/lib/i18n/customer-messages";
import type { Locale } from "@/lib/i18n/config";

export default function CustomerReviewError({ reset }: { reset: () => void }) {
  const [locale, setLocale] = useState<Locale>("en");
  return (
    <CustomerPageFallback
      kind="error"
      messages={customerMessages[locale]}
      locale={locale}
      onLocaleChange={setLocale}
      onRetry={reset}
    />
  );
}
