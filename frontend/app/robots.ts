import type { MetadataRoute } from "next";

import { absoluteUrl, PUBLIC_ROUTES } from "@/lib/site";

/**
 * Public pages may be indexed. Owner, auth, and customer tokens may not.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // The same list the sitemap publishes, so the two cannot disagree about
      // what is indexable.
      allow: [...PUBLIC_ROUTES],
      disallow: [
        "/home",
        "/feedback",
        "/praise",
        "/stands",
        "/settings",
        "/customer-page",
        "/text-requests",
        "/login",
        "/onboarding",
        "/customers",
        "/reviews",
        "/select-org",
        "/q/",
        "/api/",
        // The sign-in return and the no-connection page are not destinations.
        "/auth/",
        "/offline",
      ],
    },
    // Tells crawlers where the sitemap is without waiting for them to guess.
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
