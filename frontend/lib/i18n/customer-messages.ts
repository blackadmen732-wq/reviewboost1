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
  loadErrorBody: string;
  tryAgain: string;
  ratingHeading: string;
  ratingSupport: string;
  ratingGroup: string;
  ratingSpoken: Record<RatingValue, string>;
  ratingLabels: Record<RatingValue, string>;
  sending: string;
  submitErrorHeading: string;
  submitErrorBody: string;
  offline: string;
  thanksHeading: string;
  feedbackSent: (businessName: string) => string;
  handoffBody: string;
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
  tryAgain: "Try again",
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
  submitErrorBody: "Your rating is still here. Check your connection and try again.",
  offline: "You’re offline. We’ll try when you reconnect.",
  thanksHeading: "Thanks for sharing.",
  feedbackSent: (businessName) => `Your rating was sent to ${businessName}.`,
  handoffBody: "Taking you to the public review page…",
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
  tryAgain: "Intentar de nuevo",
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
  submitErrorBody: "Tu calificación sigue aquí. Revisa tu conexión e inténtalo de nuevo.",
  offline: "No tienes conexión. Lo intentaremos cuando vuelvas a conectarte.",
  thanksHeading: "Gracias por compartir.",
  feedbackSent: (businessName) => `Tu calificación se envió a ${businessName}.`,
  handoffBody: "Te llevamos a la página pública de reseñas…",
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
  tryAgain: "Eseye ankò",
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
  submitErrorBody: "Nòt ou bay la toujou la. Verifye koneksyon ou epi eseye ankò.",
  offline: "Ou pa konekte. N ap eseye lè ou rekonekte.",
  thanksHeading: "Mèsi paske ou pataje.",
  feedbackSent: (businessName) => `Nòt ou bay la te voye bay ${businessName}.`,
  handoffBody: "N ap mennen ou sou paj revi piblik la…",
  openReviewPage: "Ouvri paj revi a",
  poweredBy: "ReviewBoost mache paj sa a",
  footerPromise: "Biznis reyèl. Kòmantè reyèl. Yon demen pi klere.",
  businessLogoAlt: (businessName) => `Logo ${businessName}`,
};

export const customerMessages: Record<Locale, CustomerMessages> = { en, es, ht };
