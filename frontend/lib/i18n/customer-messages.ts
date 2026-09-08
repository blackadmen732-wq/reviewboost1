import type { Locale } from "@/lib/i18n/config";

export type RatingValue = 1 | 2 | 3 | 4 | 5;

/**
 * Every word a customer can read.
 *
 * The dictionary is small because the page is small: one question, one
 * instruction, five labels, and the handful of lines that appear when something
 * goes wrong. There is no note prompt, no second question, no thank-you copy and
 * no button label for continuing, because none of those steps exist. A message
 * added here is a step added to the fastest path in the product, so it needs the
 * same scrutiny as a schema change.
 */
export interface CustomerMessages {
  language: string;
  languageNames: Record<Locale, string>;
  /** The tiny code inside the hero's language control. */
  languageCodes: Record<Locale, string>;
  question: string;
  tapInstruction: string;
  ratingGroup: string;
  ratingSpoken: Record<RatingValue, string>;
  opening: string;
  ratingSaved: string;
  saveFailedHeading: string;
  saveFailedBody: string;
  offlineHeading: string;
  offlineBody: string;
  tryAgain: string;
  unavailableHeading: string;
  unavailableBody: string;
  loadErrorHeading: string;
  loadErrorBody: string;
  loading: string;
  previewLabel: string;
  /** Reads ahead of the ReviewBoost wordmark, which is rendered as the mark. */
  poweredByPrefix: string;
  brandLine: string;
  businessLogoAlt: (businessName: string) => string;
}

const languageNames = {
  en: "English",
  es: "Español",
  ht: "Kreyòl ayisyen",
} satisfies Record<Locale, string>;

const languageCodes = {
  en: "EN",
  es: "ES",
  ht: "HT",
} satisfies Record<Locale, string>;

const en: CustomerMessages = {
  language: "Language",
  languageNames,
  languageCodes,
  question: "How was your visit?",
  tapInstruction: "Tap a star to continue to Google",
  ratingGroup: "Rate your visit from 1 to 5 stars",
  ratingSpoken: {
    1: "1 star",
    2: "2 stars",
    3: "3 stars",
    4: "4 stars",
    5: "5 stars",
  },
  opening: "Opening Google…",
  ratingSaved: "Rating saved.",
  saveFailedHeading: "Couldn’t connect.",
  saveFailedBody: "Your rating is still selected.",
  offlineHeading: "You’re offline.",
  offlineBody: "Your rating is still selected. We’ll try again when you reconnect.",
  tryAgain: "Try again",
  unavailableHeading: "This Tag isn’t available.",
  unavailableBody: "Ask the business for help.",
  loadErrorHeading: "Couldn’t connect.",
  loadErrorBody: "Check your connection and try again.",
  loading: "Loading…",
  previewLabel: "Preview",
  poweredByPrefix: "Powered by",
  brandLine: "Real businesses · Real feedback · A brighter tomorrow",
  businessLogoAlt: (businessName) => `${businessName} logo`,
};

const es: CustomerMessages = {
  language: "Idioma",
  languageNames,
  languageCodes,
  question: "¿Cómo estuvo tu visita?",
  tapInstruction: "Toca una estrella para continuar a Google",
  ratingGroup: "Califica tu visita de 1 a 5 estrellas",
  ratingSpoken: {
    1: "1 estrella",
    2: "2 estrellas",
    3: "3 estrellas",
    4: "4 estrellas",
    5: "5 estrellas",
  },
  opening: "Abriendo Google…",
  ratingSaved: "Calificación guardada.",
  saveFailedHeading: "No se pudo conectar.",
  saveFailedBody: "Tu calificación sigue seleccionada.",
  offlineHeading: "No tienes conexión.",
  offlineBody:
    "Tu calificación sigue seleccionada. Lo intentaremos cuando vuelvas a conectarte.",
  tryAgain: "Intentar de nuevo",
  unavailableHeading: "Esta etiqueta no está disponible.",
  unavailableBody: "Pídele ayuda al negocio.",
  loadErrorHeading: "No se pudo conectar.",
  loadErrorBody: "Revisa tu conexión e inténtalo de nuevo.",
  loading: "Cargando…",
  previewLabel: "Vista previa",
  poweredByPrefix: "Con tecnología de",
  brandLine: "Negocios reales · Opiniones reales · Un mañana mejor",
  businessLogoAlt: (businessName) => `Logo de ${businessName}`,
};

const ht: CustomerMessages = {
  language: "Lang",
  languageNames,
  languageCodes,
  question: "Kijan vizit ou te ye?",
  tapInstruction: "Peze yon etwal pou kontinye sou Google",
  ratingGroup: "Bay vizit ou ant 1 ak 5 etwal",
  ratingSpoken: {
    1: "1 etwal",
    2: "2 etwal",
    3: "3 etwal",
    4: "4 etwal",
    5: "5 etwal",
  },
  opening: "N ap ouvri Google…",
  ratingSaved: "Nòt la sove.",
  saveFailedHeading: "Koneksyon an pa t mache.",
  saveFailedBody: "Nòt ou toujou chwazi.",
  offlineHeading: "Ou pa konekte.",
  offlineBody: "Nòt ou toujou chwazi. N ap eseye ankò lè ou rekonekte.",
  tryAgain: "Eseye ankò",
  unavailableHeading: "Etikèt sa a pa disponib.",
  unavailableBody: "Mande biznis la pou èd.",
  loadErrorHeading: "Koneksyon an pa t mache.",
  loadErrorBody: "Verifye koneksyon ou epi eseye ankò.",
  loading: "N ap chaje…",
  previewLabel: "Apèsi",
  poweredByPrefix: "Fonksyone ak",
  brandLine: "Biznis reyèl · Opinyon reyèl · Yon demen pi klere",
  businessLogoAlt: (businessName) => `Logo ${businessName}`,
};

export const customerMessages: Record<Locale, CustomerMessages> = { en, es, ht };
