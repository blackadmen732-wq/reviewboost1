"use client";

import { Zap } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { CustomerLanguageControl } from "@/features/customer-page/customer-language-control";
import { supportedLocales, type Locale } from "@/lib/i18n/config";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface CustomerPageFallbackProps {
  kind: "unavailable" | "error";
  messages: CustomerMessages;
  locale: Locale;
  onLocaleChange?: (locale: Locale) => void;
  onRetry?: () => void;
}

/**
 * What a customer sees when the Tag cannot serve a page.
 *
 * Same architecture as the working page — hero above, sheet below — because the
 * failure is ours and the customer should not be shown the seams of an app they
 * never signed up for. No status code, no "token", no "database": a person
 * holding a phone over a sticker at a counter can act on "ask the business" and
 * cannot act on anything else.
 *
 * An unavailable Tag has no retry, because nothing the customer does will make a
 * revoked Tag work; a connection failure does, because that one is worth one
 * more attempt.
 */
export function CustomerPageFallback({
  kind,
  messages,
  locale,
  onLocaleChange,
  onRetry,
}: CustomerPageFallbackProps) {
  const unavailable = kind === "unavailable";

  return (
    <main className="cp" data-mode="live">
      <div className="cp__frame">
        <div className="cp-hero cp-hero--message" data-media="neutral" data-look="minimal">
          <span className="cp-hero__scrim" aria-hidden="true" />
          <div className="cp-hero__top">
            {onLocaleChange ? (
              <CustomerLanguageControl
                locale={locale}
                languages={supportedLocales}
                messages={messages}
                onChange={onLocaleChange}
              />
            ) : null}
          </div>
          <div className="cp-hero__identity">
            <Wordmark size="lg" tone="inverse" className="cp-hero__fallback-mark" />
          </div>
        </div>

        {/* The alert is the sheet, not the heading: a heading cannot carry the
            role, and this state arrives by replacing a page the customer was
            already looking at, which nothing else would announce. */}
        <section className="cp-sheet cp-sheet--message" role="alert">
          <h1 className="cp-sheet__question">
            {unavailable ? messages.unavailableHeading : messages.loadErrorHeading}
          </h1>
          <p className="cp-sheet__instruction">
            {unavailable ? messages.unavailableBody : messages.loadErrorBody}
          </p>

          {!unavailable && onRetry ? (
            <button className="cp-sheet__retry" type="button" onClick={onRetry}>
              {messages.tryAgain}
            </button>
          ) : null}

          <footer className="cp-sheet__footer">
            <p className="cp-sheet__powered">
              <Zap className="cp-sheet__bolt" aria-hidden="true" strokeWidth={2.5} />
              <span>{messages.poweredByPrefix}</span>
              <Wordmark size="sm" tone="mono" className="cp-sheet__mark" />
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
