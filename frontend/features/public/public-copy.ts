/**
 * Public + activation copy.
 *
 * One file so integrity tests can read the words without rendering the tree.
 * No prices, no testimonials, no prevented/intercepted reviews.
 */

export const START_HREF = "/login?next=/onboarding";
export const SIGN_IN_HREF = "/login";

export const PUBLIC_NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/product", label: "Product" },
  { href: "/integrity", label: "Integrity" },
  { href: "/pricing", label: "Pricing" },
] as const;

export const PUBLIC_FOOTER = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/product", label: "Product" },
  { href: "/integrity", label: "Integrity" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/privacy", label: "Privacy" },
] as const;

export function isGetStartedNext(path: string): boolean {
  return path === "/onboarding" || path.startsWith("/onboarding?");
}

export const PUBLIC_HERO = {
  title: "A code on the counter. The same Google chance for every customer.",
  lede: "They scan, they rate, they can leave a Google review — whether they chose one star or five.",
  primary: { href: START_HREF, label: "Get started" },
  secondary: { href: SIGN_IN_HREF, label: "Sign in" },
} as const;

export const HOW_IT_WORKS = [
  {
    title: "Put a Tag where people pay",
    body: "Print a code or program an NFC tag. Same link either way.",
  },
  {
    title: "They scan and rate",
    body: "Thirty seconds on their phone. Nothing to install.",
  },
  {
    title: "Everyone is offered Google",
    body: "The rating never decides who gets the public review link. You also see the words they left for you.",
  },
] as const;

export const PRODUCT = {
  headline: "A Tag is the thing they scan.",
  lede: "One link. A printed code, or a programmed NFC tag. Customers open the same page.",
  items: [
    {
      title: "Print a code",
      body: "A QR that survives a scuffed counter. Put it by the till, the receipt, or the door.",
    },
    {
      title: "Program a tag",
      body: "Write that same link onto a blank NFC tag. They tap. The page opens. No app for them.",
    },
  ],
} as const;

export const INTEGRITY = {
  headline: "Every rating gets the same Google opportunity.",
  lede: "A one-star customer and a five-star customer are offered the same chance to review you on Google.",
  body: "Private notes are extra — never instead. We do not hide, delay, or filter the public review link because of the stars they chose.",
} as const;

export const PRICING = {
  headline: "One subscription, per location.",
  lede: "You will see the price before anything is charged.",
  caveat: "Billing is not live yet. Starting now does not bill you.",
} as const;

export const SECURITY = {
  headline: "Held the way a till should be held.",
  lede: "Owner pages need a signed-in session. Customer pages do not collect a name, phone, or email.",
} as const;

export const PRIVACY = {
  headline: "We do not ask your customers who they are.",
  lede: "The public page takes a rating and, if they want, a few words. That is all.",
} as const;

export const CLOSE = {
  headline: "Ready when you are.",
  lede: "Create a Tag, preview the customer page, print or program it, put it where people pay.",
} as const;
