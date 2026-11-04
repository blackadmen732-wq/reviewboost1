"use client";

import { Link2Off, RefreshCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/features/customer-flow/language-selector";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import { supportedLocales, type Locale } from "@/lib/i18n/config";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";
import { useAutoRetry, type AutoRetry } from "@/lib/recovery/use-auto-retry";

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
  /**
   * When given, the page tries again by itself (`useAutoRetry`): it counts
   * down to the next try, "Try now" skips the wait, and offline it waits for
   * the connection. Without it, "Try again" is the customer's alone.
   */
  retry?: AutoRetry | undefined;
}

export function CustomerBlockingState({
  kind,
  locale,
  messages,
  onLocaleChange,
  onRetry,
  retry,
}: CustomerBlockingStateProps) {
  const unavailable = kind === "unavailable";
  const settledBody =
    kind === "offline" ? messages.loadErrorBody : messages.serverErrorBody;
  // The rating screen's own panel, language pill and grey bolt footer, so a
  // customer who meets a closed or failed page still sees the same page,
  // not a second product. With no business to show, the top is white, as it
  // is for a business with no photo (DESIGN.md §8).
  return (
    <div className="customer-live">
      <CustomerVisitView
        heroUrl={null}
        transform={DEFAULT_HERO_TRANSFORM}
        heading=""
        support=""
        footerLine={messages.footerPromise}
        language={
          <LanguageSelector
            locale={locale}
            supported={supportedLocales}
            messages={messages}
            onChange={onLocaleChange}
          />
        }
      >
        <section
          className="flow-screen blocking-state"
          data-flow-screen="blocking"
          role="alert"
        >
          {/* One picture per reason. A globe here read as the language
            button beside it, and said nothing about what went wrong. */}
          <div className="blocking-state-icon" aria-hidden="true">
            {unavailable ? (
              <Link2Off size={28} strokeWidth={1.9} />
            ) : kind === "offline" ? (
              <WifiOff size={28} strokeWidth={1.9} />
            ) : (
              <RefreshCw size={28} strokeWidth={1.9} />
            )}
          </div>
          <div className="screen-heading-group">
            <h1 className="customer-question" data-screen-heading tabIndex={-1}>
              {unavailable
                ? messages.unavailableHeading
                : messages.loadErrorHeading}
            </h1>
            <p className="customer-support">
              {unavailable ? (
                messages.unavailableBody
              ) : !retry || retry.phase === "stopped" ? (
                settledBody
              ) : retry.phase === "offline" ? (
                messages.offline
              ) : retry.phase === "retrying" ? (
                messages.retrying
              ) : (
                // An alert region: a number changing every second would be
                // read out every second, so a screen reader hears one sentence.
                <>
                  <span aria-hidden="true">
                    {messages.retryingIn(retry.secondsLeft)}
                  </span>
                  <span className="sr-only">{messages.retryingSoon}</span>
                </>
              )}
            </p>
          </div>
          {unavailable ? null : retry ? (
            <Button
              variant="action"
              size="lg"
              loading={retry.phase === "retrying"}
              loadingLabel={messages.retrying}
              onClick={retry.retryNow}
            >
              {retry.phase === "stopped" ? messages.tryAgain : messages.tryNow}
            </Button>
          ) : onRetry ? (
            <Button variant="action" size="lg" onClick={onRetry}>
              {messages.tryAgain}
            </Button>
          ) : null}
        </section>
      </CustomerVisitView>
    </div>
  );
}

/**
 * The page could not load, and tries again by itself: 3 s, 10 s, 30 s, or
 * the moment the phone is back online.
 */
export function RetryingBlockingState({
  retryKey,
  failure,
  onRetry,
  ...props
}: Omit<CustomerBlockingStateProps, "retry" | "onRetry" | "kind"> & {
  kind: "offline" | "error";
  /** What failed, so the count of tries survives a re-render. */
  retryKey: string;
  /** Changes with each failed try. */
  failure: unknown;
  onRetry: () => void;
}) {
  const retry = useAutoRetry({ key: retryKey, failure, onRetry });
  return <CustomerBlockingState {...props} retry={retry} />;
}
