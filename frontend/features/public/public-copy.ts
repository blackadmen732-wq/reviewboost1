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
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
  // In the footer because that is where somebody who cannot sign in will look
  // for it, and because both app stores require it to be findable.
  { href: "/delete-account", label: "Delete account" },
] as const;

export function isGetStartedNext(path: string): boolean {
  return path === "/onboarding" || path.startsWith("/onboarding?");
}

// What it does, in the words an owner would use to describe it to a friend.
// "Hear how the visit went" was a lovely line nobody could repeat back: a
// barber reading it for three seconds could not say what the product does.
const HERO_TITLE_LINES = ["Ask every customer", "for a Google review."] as const;

export const PUBLIC_HERO = {
  /** Who it is for, before anything else, so the right visitor stays. */
  eyebrow: "For restaurants, salons, barbers and shops",
  title: HERO_TITLE_LINES.join(" "),
  titleLines: HERO_TITLE_LINES,
  // Says "Google review" because that is what owners search for and buy. It
  // promises the ask, never the outcome: every customer gets the link.
  lede: "Put a Tag by your register. Customers tap it or scan it, pick a star, and get your Google review page. You see every rating on your phone.",
  primary: { href: START_HREF, label: "Start free trial" },
  /** Three facts that remove the usual reasons not to try. Each is checked in faq.ts. */
  facts: ["7 days free on Starter", "No app for your customers", "Cancel any time"],
} as const;

export const HOW_IT_WORKS = [
  {
    title: "Put a Tag where people pay",
    body: "Print the QR code, or write it onto an NFC tag with your phone. Same link either way.",
  },
  {
    title: "They tap a star",
    body: "Their phone opens your page. One tap. No app, no sign-up, no name asked.",
  },
  {
    title: "Feedback for you. Google for everyone.",
    body: "You see the rating right away. Every customer, one star or five, is offered your Google review page.",
  },
] as const;

/**
 * Setting up, as the signup flow actually runs (features/onboarding): name,
 * Google link, the first Tag, a plan, then a test scan. Each step names what
 * the owner does, not what the screen is called.
 */
export const SETUP_STEPS = [
  { title: "Sign up with your email", body: "We email you a six-digit code. There is no password to remember." },
  {
    title: "Name your business and add your Google link",
    body: "Open your business on Google, tap “Ask for reviews”, copy the link and paste it in. We check that it is a real review link.",
  },
  { title: "Get your first Tag", body: "It is made for you. Print its QR code, or program an NFC tag with your phone." },
  {
    title: "Choose a plan to switch it on",
    body: "Starter is free for seven days. A card is needed to start, and nothing is charged until the seven days are up.",
  },
  { title: "Test it with your own phone", body: "Scan your Tag and tap a star. Your rating shows up in Feedback." },
] as const;

/** After a visit: what the owner does with what came in. */
export const AFTER_STEPS = [
  { title: "Read what is new", body: "Home says what needs you. Feedback keeps every rating, low ones included." },
  { title: "Sort the low ones", body: "Talk to your team, mark the rating sorted, and note what you did. Only your team sees the note." },
  { title: "Ask by text when it fits", body: "Send one customer your Tag's link by text, only if they agreed to hear from you." },
] as const;

/** The owner's side, said as what they get rather than what the screens are called. */
export const OWNER_SIDE = {
  eyebrow: "On your phone",
  headline: "Know how every visit went.",
  lede: "Between customers, open ReviewBoost and see what is new: fresh ratings, the low ones that need you, and whether your Tags are working.",
  items: [
    {
      title: "Every rating, as it comes in",
      body: "Home shows what is new and what needs you. Open a rating to see when it came in and at which Tag.",
    },
    {
      title: "The low ones reach you too",
      body: "A two-star visit lands in your Feedback like any other, so you can talk to your team. Mark it sorted when it is.",
    },
    {
      title: "Text a customer the link",
      body: "After a visit, send one text with your Tag's link, only to people who said yes to a text.",
    },
  ],
} as const;

/**
 * What an owner is really choosing between. Categories, never competitors'
 * names or prices: a number we did not set goes stale, and public-copy.test
 * only lets real ReviewBoost prices into public pages.
 */
export const COMPARE = {
  headline: "Why not just a review card?",
  lede: "A card on the counter is a good start. Here is what changes with ReviewBoost.",
  options: [
    {
      name: "A plain review card",
      price: "Pay once",
      body: "It opens Google, and that is all. You never hear how a visit went unless they post it.",
      ours: false,
    },
    {
      name: "ReviewBoost",
      price: "From $49 a month",
      body: "Every customer gets your Google link, and you see every rating, low ones included. Text Requests, QR and NFC included. Month to month.",
      ours: true,
    },
    {
      name: "Big review software",
      price: "A much bigger bill",
      body: "Usually a yearly contract, set up for chains, with far more than a local shop uses.",
      ours: false,
    },
  ],
} as const;

export const PRODUCT = {
  headline: "Everything you get",
  lede: "A Tag for your counter, a page for your customers, and a simple app for you.",
  // Kept for the Tag section and its tests: what a Tag is, in one line.
  tagLine: "A Tag is the thing they scan: a printed code, an NFC tag, or both, all opening the same page.",
  items: [
    {
      title: "Print a code",
      body: "Print your QR code. Put it by the till, on a receipt, or where customers can see it.",
    },
    {
      title: "Program a Tag",
      body: "Write that same link onto a blank NFC tag. They tap. The page opens. No app for them.",
    },
  ],
  groups: [
    {
      eyebrow: "For your counter",
      title: "The Tag",
      features: [
        { icon: "qr", title: "Print a code", body: "Your QR code, ready to print. Put it by the register, on a table, or on a receipt." },
        { icon: "nfc", title: "Program an NFC Tag", body: "Write the same link onto a blank NFC tag with your phone. Customers just tap." },
        { icon: "link", title: "Change your Google link any time", body: "Your Tag points at ReviewBoost, so a new Google link never means reprinting a code." },
      ],
    },
    {
      eyebrow: "For your customers",
      title: "The customer page",
      features: [
        { icon: "photo", title: "Your photo, your name", body: "Your business photo sits above the rating card. Preview it, then publish." },
        { icon: "star", title: "One tap, then Google", body: "They pick a star and get your Google review page. Every rating gets the same link." },
        { icon: "language", title: "In their language", body: "English, Español and Kreyòl ayisyen, chosen on the page with one tap." },
        { icon: "private", title: "Nothing to sign up for", body: "No app, no account, and no name, phone or email asked." },
      ],
    },
    {
      eyebrow: "For you",
      title: "Your side of the counter",
      features: [
        { icon: "home", title: "Home", body: "What needs you right now, this week's ratings and your 30-day average, at a glance." },
        { icon: "feedback", title: "Feedback", body: "Every rating in one list. Mark the low ones sorted, and note what you did for your team." },
        { icon: "insights", title: "Insights", body: "Your average over 7, 30 or 90 days, how it is moving, and which stars it is made of." },
        { icon: "texts", title: "Text Requests", body: "Text one customer your Tag's link with approved wording, only when they agreed to a text." },
      ],
    },
  ],
} as const;

export const INTEGRITY = {
  headline: "Every rating gets the same Google opportunity.",
  lede: "A one-star customer and a five-star customer are offered the same chance to review you on Google.",
  body: "We do not hide, delay, or filter the public review link because of the stars they chose. There is no version of this page that routes an unhappy customer somewhere quieter.",
  // Why it matters to the owner, not just to us: Google's own rules.
  rule: "Google does not allow asking only happy customers for a review. ReviewBoost never does, so your reviews stay real.",
} as const;

export const PRICING = {
  headline: "Simple plans for local businesses.",
  lede: "Choose by how many places and Tags you need. Month to month, cancel any time.",
  // Stripe billing is live. This used to read "Billing is not live yet",
  // which was true when it was written and is now the kind of stale sentence
  // that makes a visitor doubt everything else on the page.
  caveat:
    "Starter has a seven-day free trial, card required. Growth and Pro are charged when you subscribe.",
} as const;

export const SECURITY = {
  headline: "Ratings stay private to your business.",
  lede: "Only you and your team can read them, once signed in. Customers give a star and nothing else — no name, phone, or email.",
} as const;

export const PRIVACY = {
  headline: "We do not ask your customers who they are.",
  // V1 takes the star and nothing else — no note field, and no team praise.
  // A privacy disclosure that overstates what is collected is the one kind of
  // copy that cannot be approximately right.
  lede: "The public page takes a rating. That is all.",
} as const;

export const CLOSE = {
  headline: "Put your first Tag on the counter.",
  lede: "Sign up, add your Google link, then print your code or program a Tag. Your first ratings can come in today.",
  note: "Starter is free for 7 days. A card is needed to start; nothing is charged until the seven days are up.",
} as const;
