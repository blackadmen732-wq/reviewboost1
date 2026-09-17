import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { absoluteUrl, PUBLIC_ROUTES, SITE_URL } from "@/lib/site";

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

  it("publishes every public page that exists", () => {
    // A page added under (public) without being listed is a page no crawler
    // will ever find.
    const dir = join(ROOT, "app/(public)");
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      expect(
        PUBLIC_ROUTES as readonly string[],
        `/${entry.name} exists but is not in PUBLIC_ROUTES`,
      ).toContain(`/${entry.name}`);
    }
  });
});

describe("social cards and canonicals resolve", () => {
  const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");

  it("sets metadataBase, without which relative metadata URLs go nowhere", () => {
    expect(layout).toContain("metadataBase");
    expect(layout).toContain("SITE_URL");
  });

  it("declares a canonical, an Open Graph card and a Twitter card", () => {
    expect(layout).toContain("alternates");
    expect(layout).toContain("openGraph");
    expect(layout).toContain("summary_large_image");
  });

  it("points at a social image that is actually in the repository", () => {
    expect(layout).toContain("/brand/og.png");
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
