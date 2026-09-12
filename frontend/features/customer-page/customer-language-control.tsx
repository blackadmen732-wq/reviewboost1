"use client";

import { Globe } from "lucide-react";

import { isLocale, type Locale } from "@/lib/i18n/config";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface CustomerLanguageControlProps {
  locale: Locale;
  languages: readonly Locale[];
  messages: CustomerMessages;
  onChange: (locale: Locale) => void;
}

/**
 * Language, kept out of the way.
 *
 * The page already opens in the right language nearly every time — the browser
 * says which one it wants and the business has a default — so a full picker at
 * the top would be a prominent control that almost nobody needs, sitting above
 * the one control everybody needs. This is a glyph and two letters in the corner
 * of the photograph.
 *
 * A real `<select>` underneath, transparent and covering the pill: that gets the
 * native picker on a phone, keyboard support, and correct announcement without
 * any of it being drawn by us.
 */
export function CustomerLanguageControl({
  locale,
  languages,
  messages,
  onChange,
}: CustomerLanguageControlProps) {
  if (languages.length < 2) return null;

  return (
    <label className="cp-language">
      <span className="sr-only">{messages.language}</span>
      <Globe className="cp-language__icon" aria-hidden="true" strokeWidth={2} />
      <span className="cp-language__code" aria-hidden="true">
        {messages.languageCodes[locale]}
      </span>
      <select
        className="cp-language__select"
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) onChange(event.target.value);
        }}
      >
        {languages.map((item) => (
          <option value={item} key={item}>
            {messages.languageNames[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
