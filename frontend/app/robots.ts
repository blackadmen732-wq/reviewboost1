import type { MetadataRoute } from "next";

/**
 * Public pages may be indexed. Owner, auth, and customer tokens may not.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/how-it-works",
        "/product",
        "/integrity",
        "/pricing",
        "/security",
        "/privacy",
        // Both are public documents the app stores link to directly.
        "/terms",
        "/support",
      ],
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
