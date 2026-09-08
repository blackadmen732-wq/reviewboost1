"use client";

import { BusinessHero } from "@/features/customer-page/business-hero";
import { CustomerLanguageControl } from "@/features/customer-page/customer-language-control";
import type { CustomerPageStatus } from "@/features/customer-page/customer-page-status";
import { RatingSheet } from "@/features/customer-page/rating-sheet";
import type { CustomerPagePresentation } from "@/lib/customer-page/design";
import type { Locale } from "@/lib/i18n/config";
import type { CustomerMessages, RatingValue } from "@/lib/i18n/customer-messages";

interface CustomerPageProps {
  presentation: CustomerPagePresentation;
  messages: CustomerMessages;
  locale: Locale;
  rating: RatingValue | null;
  status: CustomerPageStatus;
  onSelect: (rating: RatingValue) => void;
  onCommit?: (rating: RatingValue) => void;
  onRetry?: () => void;
  onLocaleChange?: (locale: Locale) => void;
  /**
   * `preview` is the owner looking at their own page. The stars fill so the
   * design can be judged, and nothing is saved, counted, or handed off.
   */
  mode?: "live" | "preview";
  /** Fixes the page to a device height, for the owner's phone preview. */
  viewportHeight?: number;
}

/**
 * The customer page: a business's hero above ReviewBoost's rating sheet.
 *
 * This exact component renders on the customer's phone and inside the owner's
 * preview. Not a copy of it, not an approximation of it — the same file, so the
 * two cannot drift, and an owner who is happy with what they see is looking at
 * what will actually be scanned.
 *
 * Purely presentational. Saving, retrying, and the handoff to Google live in the
 * container, which is what makes the preview safe: with no `onCommit`, there is
 * no path from this component to a write.
 */
export function CustomerPage({
  presentation,
  messages,
  locale,
  rating,
  status,
  onSelect,
  onCommit,
  onRetry,
  onLocaleChange,
  mode = "live",
  viewportHeight,
}: CustomerPageProps) {
  // A nested <main> would be a second main landmark on the owner's screen.
  const Root = mode === "live" ? "main" : "div";

  return (
    <Root
      className="cp"
      data-mode={mode}
      {...(viewportHeight
        ? { style: { "--cp-height": `${viewportHeight}px` } as React.CSSProperties }
        : {})}
    >
      <div className="cp__frame">
        <BusinessHero
          businessName={presentation.businessName}
          design={presentation.design}
          logoAlt={messages.businessLogoAlt(presentation.businessName)}
        >
          {mode === "preview" ? (
            <span className="cp-preview-badge">{messages.previewLabel}</span>
          ) : null}
          {onLocaleChange ? (
            <CustomerLanguageControl
              locale={locale}
              languages={presentation.languages}
              messages={messages}
              onChange={onLocaleChange}
            />
          ) : null}
        </BusinessHero>

        <RatingSheet
          messages={messages}
          rating={rating}
          status={status}
          onSelect={onSelect}
          {...(onCommit ? { onCommit } : {})}
          {...(onRetry ? { onRetry } : {})}
        />
      </div>
    </Root>
  );
}
