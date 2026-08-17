"use client";

import { Globe2 } from "lucide-react";

import { isLocale, type Locale } from "@/lib/i18n/config";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface LanguageSelectorProps {
  locale: Locale;
  supported: readonly Locale[];
  messages: CustomerMessages;
  onChange: (locale: Locale) => void;
}

export function LanguageSelector({
  locale,
  supported,
  messages,
  onChange,
}: LanguageSelectorProps) {
  return (
    <label className="language-selector">
      <span className="sr-only">{messages.language}</span>
      <Globe2 aria-hidden="true" size={18} strokeWidth={2} />
      <select
        className="language-select"
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) onChange(event.target.value);
        }}
        aria-label={messages.language}
      >
        {supported.map((item) => (
          <option value={item} key={item}>
            {messages.languageNames[item]}
          </option>
        ))}
      </select>
    </label>
  );
}

