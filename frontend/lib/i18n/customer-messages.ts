import type { Locale } from "@/lib/i18n/config";

export type RatingValue = 1 | 2 | 3 | 4 | 5;

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
  noteLabel: string;
  optional: string;
  notePlaceholder: string;
  noteTrust: (businessName: string) => string;
  continue: string;
  sending: string;
  submitErrorHeading: string;
  submitErrorBody: string;
  offline: string;
  thanksHeading: string;
  feedbackSent: (businessName: string) => string;
  googlePrompt: string;
  googleAction: string;
  googleContinue: string;
  googleTrust: (businessName: string) => string;
  praiseHeading: string;
  praiseSupport: (businessName: string) => string;
  firstNameLabel: string;
  praiseNoteLabel: string;
  praiseNotePlaceholder: string;
  sendThanks: string;
  skip: string;
  requiredFirstName: string;
  praiseErrorHeading: string;
  praiseErrorBody: string;
  doneHeading: string;
  doneBody: string;
  closePage: string;
  poweredBy: string;
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
  ratingSupport: "Tap a star to let us know.",
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
  noteLabel: "Want to add a note?",
  optional: "optional",
  notePlaceholder: "Tell us anything you’d like us to know",
  noteTrust: (businessName) => `Your note goes directly to ${businessName}.`,
  continue: "Continue",
  sending: "Sending…",
  submitErrorHeading: "That didn’t go through.",
  submitErrorBody: "Your feedback is still here. Check your connection and try again.",
  offline: "You’re offline. We’ll try when you reconnect.",
  thanksHeading: "Thanks for sharing.",
  feedbackSent: (businessName) => `Your feedback was sent to ${businessName}.`,
  googlePrompt: "Want to share your experience on Google too?",
  googleAction: "Leave a Google review",
  googleContinue: "Continue without Google",
  googleTrust: (businessName) =>
    `Google reviews are public. Your note to ${businessName} is private.`,
  praiseHeading: "Want to thank someone?",
  praiseSupport: (businessName) => `Only ${businessName} will see this.`,
  firstNameLabel: "Their first name",
  praiseNoteLabel: "What did they do well?",
  praiseNotePlaceholder: "Share a few words (optional)",
  sendThanks: "Send thanks",
  skip: "Skip",
  requiredFirstName: "Enter their first name to send thanks.",
  praiseErrorHeading: "That didn’t go through.",
  praiseErrorBody: "Your thanks is still here. Check your connection and try again.",
  doneHeading: "You’re all done.",
  doneBody: "Thanks for helping a local business improve.",
  closePage: "You can close this page.",
  poweredBy: "Powered by ReviewBoost",
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
  ratingSupport: "Toca una estrella para contarnos.",
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
  noteLabel: "¿Quieres agregar una nota?",
  optional: "opcional",
  notePlaceholder: "Cuéntanos lo que quieras que sepamos",
  noteTrust: (businessName) => `Tu nota va directamente a ${businessName}.`,
  continue: "Continuar",
  sending: "Enviando…",
  submitErrorHeading: "No se pudo enviar.",
  submitErrorBody: "Tus comentarios siguen aquí. Revisa tu conexión e inténtalo de nuevo.",
  offline: "No tienes conexión. Lo intentaremos cuando vuelvas a conectarte.",
  thanksHeading: "Gracias por compartir.",
  feedbackSent: (businessName) => `Tus comentarios se enviaron a ${businessName}.`,
  googlePrompt: "¿También quieres compartir tu experiencia en Google?",
  googleAction: "Dejar una reseña en Google",
  googleContinue: "Continuar sin Google",
  googleTrust: (businessName) =>
    `Las reseñas de Google son públicas. Tu nota para ${businessName} es privada.`,
  praiseHeading: "¿Quieres agradecerle a alguien?",
  praiseSupport: (businessName) => `Solo ${businessName} verá esto.`,
  firstNameLabel: "Su nombre",
  praiseNoteLabel: "¿Qué hizo bien?",
  praiseNotePlaceholder: "Comparte unas palabras (opcional)",
  sendThanks: "Enviar agradecimiento",
  skip: "Omitir",
  requiredFirstName: "Escribe su nombre para enviar el agradecimiento.",
  praiseErrorHeading: "No se pudo enviar.",
  praiseErrorBody: "Tu agradecimiento sigue aquí. Revisa tu conexión e inténtalo de nuevo.",
  doneHeading: "Eso es todo.",
  doneBody: "Gracias por ayudar a mejorar un negocio local.",
  closePage: "Puedes cerrar esta página.",
  poweredBy: "Con tecnología de ReviewBoost",
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
  ratingSupport: "Peze yon etwal pou fè nou konnen.",
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
  noteLabel: "Ou vle ajoute yon nòt?",
  optional: "opsyonèl",
  notePlaceholder: "Di nou nenpòt bagay ou ta renmen nou konnen",
  noteTrust: (businessName) => `Nòt ou ale dirèkteman bay ${businessName}.`,
  continue: "Kontinye",
  sending: "N ap voye…",
  submitErrorHeading: "Sa pa t pase.",
  submitErrorBody: "Kòmantè ou toujou la. Verifye koneksyon ou epi eseye ankò.",
  offline: "Ou pa konekte. N ap eseye lè ou rekonekte.",
  thanksHeading: "Mèsi paske ou pataje.",
  feedbackSent: (businessName) => `Kòmantè ou te voye bay ${businessName}.`,
  googlePrompt: "Ou vle pataje eksperyans ou sou Google tou?",
  googleAction: "Kite yon revi sou Google",
  googleContinue: "Kontinye san Google",
  googleTrust: (businessName) =>
    `Revi Google yo piblik. Nòt ou pou ${businessName} prive.`,
  praiseHeading: "Ou vle remèsye yon moun?",
  praiseSupport: (businessName) => `Se sèlman ${businessName} ki pral wè sa.`,
  firstNameLabel: "Prenon yo",
  praiseNoteLabel: "Kisa yo te fè byen?",
  praiseNotePlaceholder: "Pataje kèk mo (opsyonèl)",
  sendThanks: "Voye remèsiman",
  skip: "Sote",
  requiredFirstName: "Antre prenon yo pou voye remèsiman.",
  praiseErrorHeading: "Sa pa t pase.",
  praiseErrorBody: "Remèsiman ou toujou la. Verifye koneksyon ou epi eseye ankò.",
  doneHeading: "Ou fini.",
  doneBody: "Mèsi paske ou ede yon biznis lokal amelyore.",
  closePage: "Ou ka fèmen paj sa a.",
  poweredBy: "ReviewBoost mache paj sa a",
  businessLogoAlt: (businessName) => `Logo ${businessName}`,
};

export const customerMessages: Record<Locale, CustomerMessages> = { en, es, ht };

