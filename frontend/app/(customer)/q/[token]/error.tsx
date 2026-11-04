"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { customerMessages } from "@/lib/i18n/customer-messages";
import type { Locale } from "@/lib/i18n/config";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";

/**
 * A customer who scanned a Tag should not have to work out what to do when
 * the page fails: it tries again by itself after 3 s, 10 s and 30 s (or the
 * moment the phone is back online), counting down, with "Try now".
 *
 * A try is Next's `retry`: it asks the server for the page again. With
 * `reset` it re-rendered the failure itself, so a customer whose page failed
 * on a moment's trouble could tap it forever.
 */
export default function CustomerReviewError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  const pathname = usePathname();
  const auto = useAutoRetry({
    key: `customer:${pathname}`,
    failure: error,
    onRetry: retry,
  });
  return (
    <CustomerBlockingState
      kind="error"
      locale={locale}
      messages={customerMessages[locale]}
      onLocaleChange={setLocale}
      retry={auto}
    />
  );
}
