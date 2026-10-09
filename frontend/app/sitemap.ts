import type { MetadataRoute } from "next";

import { absoluteUrl, PUBLIC_ROUTES } from "@/lib/site";

/**
 * The public site, and only the public site.
 *
 * Reads the same list `robots.ts` allows, so the two cannot disagree about what
 * is indexable. Nothing behind a session appears here, and neither does
 * `/q/{token}`: a customer's rating page belongs to one business, and listing
 * it for crawlers would turn every Tag into an indexed page nobody asked for.
 *
 * No lastModified. It would either be `new Date()` — which tells a crawler
 * every page changed on every build, and is a lie — or a hand-maintained date
 * that rots.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route),
    // The homepage is the entry point; the rest are equal to each other.
    priority: route === "/" ? 1 : 0.8,
  }));
}
