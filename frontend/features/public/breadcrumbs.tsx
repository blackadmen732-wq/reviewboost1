import Link from "next/link";

import { PUBLIC_FOOTER } from "@/features/public/public-copy";
import { absoluteUrl, type PublicRoute, SITE_NAME } from "@/lib/site";

/** The page's short name, as the footer already calls it. */
export function breadcrumbLabel(path: PublicRoute): string {
  return PUBLIC_FOOTER.find((item) => item.href === path)?.label ?? SITE_NAME;
}

/** BreadcrumbList for one public page: the site, then the page. */
export function breadcrumbJsonLd(path: PublicRoute): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE_NAME,
        item: absoluteUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: breadcrumbLabel(path),
        item: absoluteUrl(path),
      },
    ],
  }).replace(/</g, "\\u003c");
}

/**
 * "ReviewBoost / Pricing" above a public page's title, and the same trail for
 * search engines. The site is one level deep, so the trail is always two
 * steps; it exists so a visitor who landed from search can see where they are
 * and get to the homepage in one tap.
 */
export function Breadcrumbs({
  path,
  align = "start",
}: {
  path: PublicRoute;
  align?: "start" | "center";
}) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol
          className={`flex flex-wrap items-center gap-x-2 text-sm text-muted${align === "center" ? " justify-center" : ""}`}
        >
          <li>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              {SITE_NAME}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <span aria-current="page" className="text-ink">
              {breadcrumbLabel(path)}
            </span>
          </li>
        </ol>
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd(path) }}
      />
    </>
  );
}
