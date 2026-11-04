import type { Locale } from "@/lib/i18n/config";

export type RatingValue = 1 | 2 | 3 | 4 | 5;

/**
 * Copy for the V1 customer contract: a rating and a handoff.
 *
 * There is deliberately no vocabulary here for a note, for Team Praise, or for
 * declining the review destination. Removing the words is what stops those
 * screens quietly reappearing.
 */
export interface CustomerMessages {
  language: string;
  languageNames: Record<Locale, string>;
  opening: string;
  unavailableHeading: string;
  unavailableBody: string;
  loadErrorHeading: string;
  /** The page could not load because the phone has no connection. */
  loadErrorBody: string;
  /** The page could not load or save because of us, not the phone. */
  serverErrorBody: string;
  tryAgain: string;
  /** The page failed to load and tries again by itself, counting down. */
  retryingIn: (seconds: number) => string;
  /** The same, said once to a screen reader instead of every second. */
  retryingSoon: string;
  retrying: string;
  /** Skip the countdown. */
  tryNow: string;
  ratingHeading: string;
  ratingSupport: string;
  ratingGroup: string;
  ratingSpoken: Record<RatingValue, string>;
  ratingLabels: Record<RatingValue, string>;
  sending: string;
  submitErrorHeading: string;
  submitErrorBody: string;
  /** The rating did not save and is sent again by itself, counting down. */
  submitRetryingIn: (seconds: number) => string;
  /** The same, said once to a screen reader instead of every second. */
  submitRetryingSoon: string;
  offline: string;
  thanksHeading: string;
  feedbackSent: (businessName: string) => string;
  handoffBody: string;
  /** A handoff restored from an earlier visit: nothing moves by itself. */
  handoffReturnBody: string;
  openReviewPage: string;
  poweredBy: string;
  footerPromise: string;
  businessLogoAlt: (businessName: string) => string;
}

const languageNames = {
  en: "English",
  es: "Español",
  ht: "Kreyòl ayisyen",
} satisfies Record<Locale, string>;

const en: CustomerMessages = {
  language: "Language",
  languageNames,
  opening: "Opening the review page…",
  unavailableHeading: "This review link isn’t active.",
  unavailableBody: "Please ask the business for a new one.",
  loadErrorHeading: "That didn’t go through.",
  loadErrorBody: "Check your connection and try again.",
  serverErrorBody: "Try again in a moment.",
  tryAgain: "Try again",
  retryingIn: (seconds) => `Trying again in ${seconds} s.`,
  retryingSoon: "Trying again in a few seconds.",
  retrying: "Trying again…",
  tryNow: "Try now",
  ratingHeading: "How was your visit?",
  ratingSupport: "Tap a star to continue to Google",
  ratingGroup: "Rate your visit from 1 to 5 stars",
  ratingSpoken: {
    1: "1 star — Not good",
    2: "2 stars — Could be better",
    3: "3 stars — Good",
    4: "4 stars — Great",
    5: "5 stars — Excellent",
  },
  ratingLabels: {
    1: "Not good",
    2: "Could be better",
    3: "Good",
    4: "Great",
    5: "Excellent",
  },
  sending: "Sending…",
  submitErrorHeading: "That didn’t go through.",
  submitErrorBody: "Your rating is still here. Try again in a moment.",
  submitRetryingIn: (seconds) => `Your rating is still here. Trying again in ${seconds} s.`,
  submitRetryingSoon: "Your rating is still here. Trying again in a few seconds.",
  offline: "You’re offline. We’ll try when you reconnect.",
  thanksHeading: "Thanks for sharing.",
  feedbackSent: (businessName) => `Your rating was sent to ${businessName}.`,
  handoffBody: "Taking you to the public review page…",
  handoffReturnBody: "Tap below to open the review page.",
  openReviewPage: "Open the review page",
  poweredBy: "Powered by ReviewBoost",
  footerPromise: "Real businesses. Real feedback. A brighter tomorrow.",
  businessLogoAlt: (businessName) => `${businessName} logo`,
};

const es: CustomerMessages = {
  language: "Idioma",
  languageNames,
  opening: "Abriendo la página de reseñas…",
  unavailableHeading: "Este enlace de reseña no está activo.",
  unavailableBody: "Pídele uno nuevo al negocio.",
  loadErrorHeading: "No se pudo enviar.",
  loadErrorBody: "Revisa tu conexión e inténtalo de nuevo.",
  serverErrorBody: "Inténtalo de nuevo en un momento.",
  tryAgain: "Intentar de nuevo",
  retryingIn: (seconds) => `Reintentando en ${seconds} s.`,
  retryingSoon: "Reintentando en unos segundos.",
  retrying: "Reintentando…",
  tryNow: "Intentar ahora",
  ratingHeading: "¿Cómo estuvo tu visita?",
  ratingSupport: "Toca una estrella para continuar a Google",
  ratingGroup: "Califica tu visita de 1 a 5 estrellas",
  ratingSpoken: {
    1: "1 estrella — No estuvo bien",
    2: "2 estrellas — Podría ser mejor",
    3: "3 estrellas — Bien",
    4: "4 estrellas — Muy bien",
    5: "5 estrellas — Excelente",
  },
  ratingLabels: {
    1: "No estuvo bien",
    2: "Podría ser mejor",
    3: "Bien",
    4: "Muy bien",
    5: "Excelente",
  },
  sending: "Enviando…",
  submitErrorHeading: "No se pudo enviar.",
  submitErrorBody: "Tu calificación sigue aquí. Inténtalo de nuevo en un momento.",
  submitRetryingIn: (seconds) => `Tu calificación sigue aquí. Reintentando en ${seconds} s.`,
  submitRetryingSoon: "Tu calificación sigue aquí. Reintentando en unos segundos.",
  offline: "No tienes conexión. Lo intentaremos cuando vuelvas a conectarte.",
  thanksHeading: "Gracias por compartir.",
  feedbackSent: (businessName) => `Tu calificación se envió a ${businessName}.`,
  handoffBody: "Te llevamos a la página pública de reseñas…",
  handoffReturnBody: "Toca abajo para abrir la página de reseñas.",
  openReviewPage: "Abrir la página de reseñas",
  poweredBy: "Con tecnología de ReviewBoost",
  footerPromise: "Negocios reales. Comentarios reales. Un mañana más brillante.",
  businessLogoAlt: (businessName) => `Logo de ${businessName}`,
};

const ht: CustomerMessages = {
  language: "Lang",
  languageNames,
  opening: "N ap ouvri paj revi a…",
  unavailableHeading: "Lyen revi sa a pa aktif.",
  unavailableBody: "Tanpri mande biznis la yon nouvo lyen.",
  loadErrorHeading: "Sa pa t pase.",
  loadErrorBody: "Verifye koneksyon ou epi eseye ankò.",
  serverErrorBody: "Eseye ankò nan yon ti moman.",
  tryAgain: "Eseye ankò",
  retryingIn: (seconds) => `N ap eseye ankò nan ${seconds} s.`,
  retryingSoon: "N ap eseye ankò nan kèk segonn.",
  retrying: "N ap eseye ankò…",
  tryNow: "Eseye kounye a",
  ratingHeading: "Kijan vizit ou te ye?",
  ratingSupport: "Peze yon etwal pou kontinye sou Google",
  ratingGroup: "Bay vizit ou ant 1 ak 5 etwal",
  ratingSpoken: {
    1: "1 etwal — Pa bon",
    2: "2 etwal — Li ta ka pi bon",
    3: "3 etwal — Bon",
    4: "4 etwal — Trè bon",
    5: "5 etwal — Ekselan",
  },
  ratingLabels: {
    1: "Pa bon",
    2: "Li ta ka pi bon",
    3: "Bon",
    4: "Trè bon",
    5: "Ekselan",
  },
  sending: "N ap voye…",
  submitErrorHeading: "Sa pa t pase.",
  submitErrorBody: "Nòt ou bay la toujou la. Eseye ankò nan yon ti moman.",
  submitRetryingIn: (seconds) => `Nòt ou bay la toujou la. N ap eseye ankò nan ${seconds} s.`,
  submitRetryingSoon: "Nòt ou bay la toujou la. N ap eseye ankò nan kèk segonn.",
  offline: "Ou pa konekte. N ap eseye lè ou rekonekte.",
  thanksHeading: "Mèsi paske ou pataje.",
  feedbackSent: (businessName) => `Nòt ou bay la te voye bay ${businessName}.`,
  handoffBody: "N ap mennen ou sou paj revi piblik la…",
  handoffReturnBody: "Peze bouton an pou ouvri paj revi a.",
  openReviewPage: "Ouvri paj revi a",
  poweredBy: "ReviewBoost mache paj sa a",
  footerPromise: "Biznis reyèl. Kòmantè reyèl. Yon demen pi klere.",
  businessLogoAlt: (businessName) => `Logo ${businessName}`,
};

export const customerMessages: Record<Locale, CustomerMessages> = { en, es, ht };
