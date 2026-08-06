export const supportedLocales = ["en", "es", "ht"] as const;

export type Locale = (typeof supportedLocales)[number];

export function isLocale(value: unknown): value is Locale {
  return supportedLocales.includes(value as Locale);
}

