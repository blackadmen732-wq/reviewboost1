import { expect, type Page } from "@playwright/test";

interface SeededDesign {
  heroImage: string;
  heroFocalX: number;
  heroFocalY: number;
  heroZoom: number;
  logo: string | null;
  look: string;
  tagline: string | null;
}

export const fixtureDesign: SeededDesign = {
  heroImage: "/fixtures/customer-page-hero.jpg",
  heroFocalX: 50,
  heroFocalY: 74,
  heroZoom: 1.06,
  logo: null,
  look: "signature",
  tagline: "Good pizza. Brighter days.",
};

function storageKey(locationId: string | null = null): string {
  return `reviewboost:customer-page-design:1:org-local:${locationId ?? "all"}`;
}

function publishedRecord(design: SeededDesign) {
  return {
    version: 1,
    published: design,
    draft: null,
    publishedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Installs a published design before the app's own code loads.
 *
 * Must be an init script, not a write-then-reload. Reloading unmounts the
 * designer, which flushes the empty first-run draft on top of the seed.
 */
export async function seedPublishedPage(
  page: Page,
  design: SeededDesign = fixtureDesign,
  locationId: string | null = null,
): Promise<void> {
  const key = storageKey(locationId);
  const payload = JSON.stringify(publishedRecord(design));
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(payload)});`,
  );
}

export async function openDesigner(
  page: Page,
  query: {
    locations?: "one" | "many";
    role?: "owner" | "viewer";
    published?: SeededDesign;
  } = {},
): Promise<void> {
  if (query.published) {
    await seedPublishedPage(page, query.published);
  }

  const params = new URLSearchParams();
  if (query.locations) params.set("locations", query.locations);
  if (query.role) params.set("role", query.role);
  const suffix = params.size ? `?${params.toString()}` : "";
  await page.goto(`/customer-page${suffix}`);
  await expect(page.getByRole("heading", { name: "Customer Page" })).toBeVisible();
}

export function phonePreview(page: Page) {
  return page.locator(".cp-device .cp");
}

/** The look name, not the hidden radio — the label sits on top of the input. */
export async function chooseLook(page: Page, look: string): Promise<void> {
  await page.getByText(look, { exact: true }).click();
}
