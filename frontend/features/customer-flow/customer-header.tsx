"use client";

import { useState } from "react";

import { LanguageSelector } from "@/features/customer-flow/language-selector";
import type { CustomerReviewContext } from "@/lib/api/customer-flow-types";
import type { Locale } from "@/lib/i18n/config";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface CustomerHeaderProps {
  context: CustomerReviewContext;
  locale: Locale;
  messages: CustomerMessages;
  onLocaleChange: (locale: Locale) => void;
}

export function CustomerHeader({
  context,
  locale,
  messages,
  onLocaleChange,
}: CustomerHeaderProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = logoFailed ? null : context.business.logoUrl;
  const initial = context.business.name.trim().slice(0, 1).toLocaleUpperCase(locale);

  return (
    <header className="customer-header">
      <div className="business-identity">
        <div className="business-avatar">
          {logoUrl ? (
            // Business media origins are part of the missing backend contract;
            // the backend is responsible for returning an optimized logo URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={messages.businessLogoAlt(context.business.name)}
              width={48}
              height={48}
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span aria-hidden="true">{initial}</span>
          )}
        </div>
        <div className="business-identity__copy">
          <p className="business-name">{context.business.name}</p>
          {context.location.name ? <p className="location-name">{context.location.name}</p> : null}
        </div>
      </div>
      <LanguageSelector
        locale={locale}
        supported={context.supportedLocales}
        messages={messages}
        onChange={onLocaleChange}
      />
    </header>
  );
}
