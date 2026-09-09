import type { MetadataRoute } from "next";

/**
 * Public pages may be indexed. Owner, auth, and customer tokens may not.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/how-it-works", "/product", "/integrity", "/pricing", "/security", "/privacy"],
      disallow: [
        "/home",
        "/feedback",
        "/praise",
        "/stands",
        "/settings",
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
