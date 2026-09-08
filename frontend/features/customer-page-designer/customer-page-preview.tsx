"use client";

import { useState } from "react";

import { CustomerPage } from "@/features/customer-page/customer-page";
import {
  previewHeight,
  previewWidth,
} from "@/features/customer-page-designer/hero-frame";
import { presentationFromDesign } from "@/lib/customer-page/presentation";
import type { CustomerPageDesign } from "@/lib/customer-page/design";
import type { Locale } from "@/lib/i18n/config";
import { customerMessages, type RatingValue } from "@/lib/i18n/customer-messages";

interface CustomerPagePreviewProps {
  design: CustomerPageDesign;
  businessName: string;
  locationName: string | null;
  languages: readonly Locale[];
}

/**
 * The customer page, at phone size, on the owner's screen.
 *
 * It renders the production component — the same file the customer's phone
 * loads — because an owner who approves an approximation has approved nothing.
 * The stars fill when clicked so the page can be judged as a page, and that is
 * all they do: no `onCommit` is passed, so there is no code path from here to a
 * rating, an analytics event, or Google.
 */
export function CustomerPagePreview({
  design,
  businessName,
  locationName,
  languages,
}: CustomerPagePreviewProps) {
  const [rating, setRating] = useState<RatingValue | null>(null);
  const [locale, setLocale] = useState<Locale>(languages[0] ?? "en");

  return (
    <div
      className="cp-device shrink-0"
      style={
        {
          "--cp-device-width": `${previewWidth}px`,
          "--cp-device-height": `${previewHeight}px`,
        } as React.CSSProperties
      }
    >
      <div className="cp-device__body">
        <div className="cp-device__screen">
          <CustomerPage
            presentation={presentationFromDesign({
              businessName,
              locationName,
              design,
              languages,
            })}
            messages={customerMessages[locale]}
            locale={locale}
            rating={rating}
            status="idle"
            onSelect={setRating}
            onLocaleChange={setLocale}
            mode="preview"
            viewportHeight={previewHeight}
          />
        </div>
      </div>
    </div>
  );
}
