import type { Metadata } from "next";

/**
 * The canonical public origin, in one place.
 *
 * `docs/backend/ENVIRONMENT.md` and `.env.example` both name reviewboost.fit as
 * production; reviewboost.app is the retired alternative. Contact addresses on
 * it were dead mailboxes, and a canonical URL on it would be worse — it would
 * hand search engines a second origin to index and split the site against
 * itself.
 *
 * Deliberately a constant rather than `publicFrontendUrl()`. That accessor is
 * server-only and throws in production when unset, which is right for the
 * origin printed onto a physical Tag but wrong for page metadata: a missing
 * environment variable should not fail a build or take down a marketing page.
 * The two are checked against each other by test.
 */
export const SITE_URL = "https://reviewboost.fit";

/** Absolute URL for a path, for canonicals and social cards. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

/**
 * Every public, indexable route.
 *
 * The sitemap and the robots allow-list both read this, so adding a page in one
 * and forgetting the other stops being possible. Owner routes, `/login` and
 * `/q/{token}` are deliberately absent — a customer's Tag page is not a
 * marketing landing page and must never be indexed as one.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/product",
  "/how-it-works",
  "/pricing",
  "/integrity",
  "/security",
  "/privacy",
  "/terms",
  "/support",
  // Both app stores require a publicly reachable deletion URL, readable by
  // somebody who has already lost access to their account.
  "/delete-account",
] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

export const SITE_NAME = "ReviewBoost";

/**
 * Structured data for the homepage: who runs the site and where it lives.
 * Organization and WebSite only — no ratings, prices or reviews, which search
 * engines treat as claims and which this file has no way to keep true.
 * `<` is escaped so the payload can never close its own script tag.
 */
export const SITE_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/brand/icon-512.png`,
      email: "help@reviewboost.fit",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
}).replace(/</g, "\\u003c");

/**
 * The parts of a social card every page shares. Kept here because Next merges
 * metadata shallowly: a page that sets `openGraph` replaces the layout's whole
 * object, so anything left out here would silently vanish from that page.
 */
export const SHARED_OPEN_GRAPH = {
  type: "website",
  siteName: SITE_NAME,
  locale: "en_US",
  // The approved mark on the brand tile. Not a screenshot of the product:
  // a shrunk dashboard is unreadable at the size a link preview renders.
  images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: SITE_NAME }],
} satisfies Metadata["openGraph"];

export const SHARED_TWITTER = {
  card: "summary_large_image",
  images: ["/brand/og.png"],
} satisfies Metadata["twitter"];

/**
 * Metadata for one public page: its own canonical and its own social card.
 *
 * The canonical must be per page. Set once in the root layout it is inherited
 * by every route, so /pricing, /terms and the rest each told search engines
 * they were a copy of the homepage — the fastest way to have them dropped from
 * results. The same went for og:url, so a shared /pricing link previewed as
 * the homepage.
 */
export function publicPageMetadata({
  path,
  title,
  description,
}: {
  path: PublicRoute;
  title: string;
  description: string;
}): Metadata {
  const isHome = path === "/";
  const cardTitle = isHome ? SITE_NAME : `${title} — ${SITE_NAME}`;
  return {
    title: isHome ? { absolute: SITE_NAME } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      ...SHARED_OPEN_GRAPH,
      title: cardTitle,
      description,
      url: path,
    },
    twitter: { ...SHARED_TWITTER, title: cardTitle, description },
  };
}
