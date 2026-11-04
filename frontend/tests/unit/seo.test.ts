import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  absoluteUrl,
  googleSiteVerification,
  PUBLIC_ROUTES,
  publicPageMetadata,
  SHARED_OPEN_GRAPH,
  SHARED_TWITTER,
  SITE_JSON_LD,
  SITE_URL,
} from "@/lib/site";

/**
 * Search engines see whatever the metadata says, and it is the part of a site
 * nobody looks at until it is wrong.
 *
 * Three failures this pins:
 *
 * There was no `metadataBase`, so every relative URL in metadata — canonicals,
 * social images — resolved relative. A link preview with no image and a
 * canonical tag saying nothing.
 *
 * There was no sitemap at all.
 *
 * And contact details across four pages pointed at reviewboost.app while
 * ENVIRONMENT.md named reviewboost.fit as production. Two origins serving the
 * same pages is how a small site competes with itself for its own name.
 */

const ROOT = process.cwd();

describe("one canonical origin", () => {
  it("is the production domain the environment docs name", () => {
    expect(SITE_URL).toBe("https://reviewboost.fit");
    expect(SITE_URL).not.toMatch(/reviewboost\.app|vercel\.app|localhost/);
  });

  it("agrees with what .env.example tells an operator to deploy", () => {
    // The Tag origin and the metadata origin are separate accessors on purpose
    // — one throws in production, the other must never fail a build — but they
    // describe the same website and must not diverge.
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(example).toContain("https://reviewboost.fit");
  });

  it("builds absolute URLs on that origin", () => {
    expect(absoluteUrl("/pricing")).toBe("https://reviewboost.fit/pricing");
  });
});

describe("robots and the sitemap cannot disagree", () => {
  it("allows exactly the routes the sitemap publishes", () => {
    const allowed = robots().rules;
    const rule = Array.isArray(allowed) ? allowed[0]! : allowed;
    expect(rule.allow).toEqual([...PUBLIC_ROUTES]);
    expect(sitemap().map((entry) => entry.url)).toEqual(
      PUBLIC_ROUTES.map((route) => absoluteUrl(route)),
    );
  });

  it("never indexes a customer's Tag page or anything behind a session", () => {
    const rule = (() => {
      const rules = robots().rules;
      return Array.isArray(rules) ? rules[0]! : rules;
    })();
    const disallow = rule.disallow as string[];

    // A customer's rating page belongs to one business. Indexing it would turn
    // every Tag into a landing page nobody asked for.
    expect(disallow).toContain("/q/");
    expect(disallow).toContain("/api/");
    for (const owner of ["/home", "/feedback", "/settings", "/text-requests", "/customer-page"]) {
      expect(disallow, `${owner} must not be indexable`).toContain(owner);
    }
    // And nothing owner-facing sneaks into the indexable list.
    expect(PUBLIC_ROUTES as readonly string[]).not.toContain("/login");
    expect(PUBLIC_ROUTES as readonly string[]).not.toContain("/home");
  });

  it("publishes every public page that exists, or says why not", () => {
    // A page added under (public) without being listed is a page no crawler
    // will ever find.
    //
    // The exception is a page that opts out in its own metadata. /goodbye is
    // the first: it is public only because the account that would have been
    // needed to see it no longer exists, and a deletion confirmation in search
    // results would be nonsense. Requiring the opt-out to be declared in the
    // file keeps "deliberately unlisted" and "forgotten" apart — the second
    // still fails here.
    const dir = join(ROOT, "app/(public)");
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const source = readFileSync(join(dir, entry.name, "page.tsx"), "utf8");
      const optsOut = /robots:\s*\{[^}]*index:\s*false/.test(source);
      if (optsOut) continue;

      expect(
        PUBLIC_ROUTES as readonly string[],
        `/${entry.name} exists but is not in PUBLIC_ROUTES`,
      ).toContain(`/${entry.name}`);
    }
  });

  it("keeps a noindex page out of robots and the sitemap too", () => {
    // Declaring noindex in metadata and then listing the route anyway would
    // put it in the sitemap while telling crawlers to ignore it — two answers
    // to the same question.
    expect(PUBLIC_ROUTES as readonly string[]).not.toContain("/goodbye");
    expect(sitemap().map((entry) => entry.url)).not.toContain(absoluteUrl("/goodbye"));
  });
});

describe("social cards and canonicals resolve", () => {
  const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");

  it("sets metadataBase, without which relative metadata URLs go nowhere", () => {
    expect(layout).toContain("metadataBase");
    expect(layout).toContain("SITE_URL");
  });

  it("declares an Open Graph card and a Twitter card for every page", () => {
    expect(layout).toContain("openGraph");
    expect(layout).toContain("SHARED_OPEN_GRAPH");
    expect(SHARED_TWITTER.card).toBe("summary_large_image");
  });

  it("sets no site-wide canonical or og:url in the root layout", () => {
    // Inherited by every route: a canonical of "/" there told search engines
    // that /pricing, /terms and the rest were copies of the homepage.
    const metadataBlock = layout.slice(
      layout.indexOf("export const metadata"),
      layout.indexOf("export const viewport"),
    );
    expect(metadataBlock).not.toMatch(/canonical\s*:/);
    expect(metadataBlock).not.toMatch(/\burl\s*:\s*["']\/["']/);
  });

  it("gives every public page its own canonical and card URL", () => {
    const fileFor = (route: string) =>
      route === "/"
        ? "app/page.tsx"
        : route === "/support"
          ? "app/support/page.tsx"
          : `app/(public)${route}/page.tsx`;

    for (const route of PUBLIC_ROUTES) {
      const source = readFileSync(join(ROOT, fileFor(route)), "utf8");
      expect(source, `${route} must use publicPageMetadata`).toContain("publicPageMetadata(");
      expect(source, `${route} must declare its own path`).toContain(`path: "${route}"`);
    }

    const pricing = publicPageMetadata({ path: "/pricing", title: "Pricing", description: "d" });
    expect(pricing.alternates?.canonical).toBe("/pricing");
    expect((pricing.openGraph as { url?: string }).url).toBe("/pricing");
    expect(pricing.openGraph?.title).toBe("Pricing — ReviewBoost");
    // A page's openGraph replaces the layout's whole object, so the image has
    // to travel with it or the card loses its picture.
    expect(pricing.openGraph?.images).toEqual(SHARED_OPEN_GRAPH.images);

    const home = publicPageMetadata({ path: "/", title: "ReviewBoost", description: "d" });
    expect(home.alternates?.canonical).toBe("/");
    expect(home.title).toEqual({ absolute: "ReviewBoost" });
  });

  it("prints Google's verification tag only when the code is configured", () => {
    expect(googleSiteVerification("abc123")).toEqual({ google: "abc123" });
    expect(googleSiteVerification("  abc123  ")).toEqual({ google: "abc123" });
    expect(googleSiteVerification(undefined)).toBeUndefined();
    expect(googleSiteVerification("   ")).toBeUndefined();
    expect(layout).toContain("verification: googleSiteVerification()");
  });

  it("points crawlers at the sitemap from robots.txt", () => {
    expect(robots().sitemap).toBe(absoluteUrl("/sitemap.xml"));
  });

  it("describes the organisation in structured data, and nothing it cannot keep true", () => {
    const data = JSON.parse(SITE_JSON_LD) as { "@graph": Array<Record<string, unknown>> };
    const types = data["@graph"].map((node) => node["@type"]);
    expect(types).toEqual(["Organization", "WebSite"]);
    expect(SITE_JSON_LD).not.toMatch(/aggregateRating|"review"|"offers"/);
    expect(readFileSync(join(ROOT, "app/page.tsx"), "utf8")).toContain("application/ld+json");
  });

  it("publishes an llms.txt that links only to indexable pages", () => {
    const llms = readFileSync(join(ROOT, "public/llms.txt"), "utf8");
    const links = [...llms.matchAll(/\((https:\/\/reviewboost\.fit[^)]*)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(PUBLIC_ROUTES.map((route) => absoluteUrl(route))).toContain(link);
    }
  });

  it("points at a social image that is actually in the repository", () => {
    expect(SHARED_OPEN_GRAPH.images[0]!.url).toBe("/brand/og.png");
    expect(() => readFileSync(join(ROOT, "public/brand/og.png"))).not.toThrow();
  });

  it("does not reference the icon routes that were deleted", () => {
    // app/icon.tsx and app/apple-icon.tsx drew a placeholder "B" and are gone;
    // the icons are the approved raster, declared here.
    const app = readdirSync(join(ROOT, "app"));
    expect(app).not.toContain("icon.tsx");
    expect(app).not.toContain("apple-icon.tsx");
    expect(layout).toContain("/brand/icon-32.png");
  });
});

describe("the favicon set", () => {
  const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");

  it("declares .ico, SVG, PNG and the iOS home-screen icon, and every file exists", () => {
    for (const file of ["/favicon.ico", "/brand/icon.svg", "/brand/icon-16.png", "/brand/icon-32.png", "/brand/icon-192.png", "/brand/icon-180.png"]) {
      expect(layout).toContain(file);
      expect(() => readFileSync(join(ROOT, "public", file))).not.toThrow();
    }
  });

  it("ships a real multi-size .ico, which browsers ask for before reading any tag", () => {
    const ico = readFileSync(join(ROOT, "public/favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1); // an icon, not a cursor
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2); // more than one size
  });
});

describe("breadcrumbs", () => {
  it("gives every inner public page a two-step trail, home first", async () => {
    const { breadcrumbJsonLd, breadcrumbLabel } = await import("@/features/public/breadcrumbs");
    const data = JSON.parse(breadcrumbJsonLd("/pricing")) as {
      "@type": string;
      itemListElement: Array<{ position: number; name: string; item: string }>;
    };
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement.map((entry) => [entry.position, entry.name, entry.item])).toEqual([
      [1, "ReviewBoost", absoluteUrl("/")],
      [2, "Pricing", absoluteUrl("/pricing")],
    ]);
    expect(breadcrumbLabel("/delete-account")).toBe("Delete account");
  });

  it("is on every indexable page except the homepage", () => {
    const pages: Record<string, string> = {
      "/product": "app/(public)/product/page.tsx",
      "/how-it-works": "app/(public)/how-it-works/page.tsx",
      "/integrity": "app/(public)/integrity/page.tsx",
      "/security": "app/(public)/security/page.tsx",
      "/privacy": "app/(public)/privacy/page.tsx",
      "/terms": "app/(public)/terms/page.tsx",
      "/delete-account": "app/(public)/delete-account/page.tsx",
      "/support": "app/support/page.tsx",
    };
    for (const [route, file] of Object.entries(pages)) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source.includes(`breadcrumb="${route}"`) || source.includes(`<Breadcrumbs path="${route}"`), file).toBe(true);
    }
    expect(readFileSync(join(ROOT, "app/(public)/pricing/page.tsx"), "utf8")).toContain("breadcrumb ");
  });
});

describe("production build", () => {
  it("never ships source maps to the browser", () => {
    expect(readFileSync(join(ROOT, "next.config.ts"), "utf8")).toContain("productionBrowserSourceMaps: false");
  });
});
