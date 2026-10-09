import type { MetadataRoute } from "next";

import { PUBLIC_ROUTES } from "@/lib/site";

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
      ],
    },
  };
}
