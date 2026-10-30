"use client";

import { Globe2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomerFrame } from "@/features/customer-flow/customer-frame";
import { LanguageSelector } from "@/features/customer-flow/language-selector";
import { supportedLocales, type Locale } from "@/lib/i18n/config";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface CustomerBlockingStateProps {
  /**
   * Why the page cannot show. "offline" is the phone; "error" is us, so it
   * must not tell a customer with full signal to check their connection.
   */
  kind: "unavailable" | "offline" | "error";
  locale: Locale;
  messages: CustomerMessages;
  onLocaleChange: (locale: Locale) => void;
  onRetry?: () => void;
}

export function CustomerBlockingState({
  kind,
  locale,
  messages,
  onLocaleChange,
  onRetry,
}: CustomerBlockingStateProps) {
  const unavailable = kind === "unavailable";
  return (
    <CustomerFrame poweredBy={messages.poweredBy}>
      <div className="blocking-state-toolbar">
        <LanguageSelector
          locale={locale}
          supported={supportedLocales}
          messages={messages}
          onChange={onLocaleChange}
        />
      </div>
      <section className="flow-screen blocking-state" role="alert">
        <div className="blocking-state-icon" aria-hidden="true">
          <Globe2 size={28} strokeWidth={1.9} />
        </div>
        <div className="screen-heading-group">
          <h1 className="customer-question" data-screen-heading tabIndex={-1}>
            {unavailable
              ? messages.unavailableHeading
              : messages.loadErrorHeading}
          </h1>
          <p className="customer-support">
            {unavailable
              ? messages.unavailableBody
              : kind === "offline"
                ? messages.loadErrorBody
                : messages.serverErrorBody}
          </p>
        </div>
        {!unavailable && onRetry ? (
          <Button size="lg" onClick={onRetry}>
            {messages.tryAgain}
          </Button>
        ) : null}
      </section>
    </CustomerFrame>
  );
}
