"use client";

import { useState } from "react";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { customerMessages } from "@/lib/i18n/customer-messages";
import type { Locale } from "@/lib/i18n/config";

/**
 * "Try again" is Next's `retry`: it asks the server for the page again. With
 * `reset` it re-rendered the failure itself, so a customer whose page failed
 * on a moment's trouble could tap it forever.
 */
export default function CustomerReviewError({ retry }: { retry: () => void }) {
  const [locale, setLocale] = useState<Locale>("en");
  return (
    <CustomerBlockingState
      kind="error"
      locale={locale}
      messages={customerMessages[locale]}
      onLocaleChange={setLocale}
      onRetry={() => retry()}
    />
  );
}
