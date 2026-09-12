import { expect, test } from "@playwright/test";

import { chooseLook, fixtureDesign, openDesigner, phonePreview } from "./support/designer";

/**
 * The owner-facing half: compose the page, then publish it.
 *
 * The component suite already covers the store. What only a browser can settle
 * is the live preview using the real customer page, the first-run versus
 * returning-owner screens, and Preview as customer opening a page that cannot
 * write a rating.
 */

test.describe("first time through", () => {
  test("asks for a photo and already shows the real business name", async ({ page }) => {
    await openDesigner(page);

    await expect(page.getByText("Make it feel like your business.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
    await expect(phonePreview(page).getByText("Mario’s")).toBeVisible();
    await expect(
      phonePreview(page).getByRole("heading", { name: "How was your visit?" }),
    ).toBeVisible();
    await expect(page.getByLabel("Editing")).toHaveCount(0);
  });
});

test.describe("a page that is already live", () => {
  test("opens on the published page, not onboarding", async ({ page }) => {
    await openDesigner(page, { published: fixtureDesign });

    await expect(page.getByText("Make it feel like your business.")).toHaveCount(0);
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
    await expect(phonePreview(page).locator(".cp-hero__photo")).toBeVisible();
    await expect(phonePreview(page).locator(".cp-wordmark")).toHaveAttribute(
      "data-look",
      "signature",
    );
  });

  test("changing a Look updates the phone and waits for Publish", async ({ page }) => {
    await openDesigner(page, { published: fixtureDesign });

    await chooseLook(page, "Bold");
    await expect(phonePreview(page).locator(".cp-wordmark")).toHaveAttribute("data-look", "bold");
    await expect(page.getByText("Changes not published")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  test("Publish is what makes the change real", async ({ page }) => {
    await openDesigner(page, { published: fixtureDesign });

    await chooseLook(page, "Editorial");
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText("Customer Page published")).toBeVisible();
    await expect(
      page.getByText("Customers will see this version when they tap or scan."),
    ).toBeVisible();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
    await expect(phonePreview(page).locator(".cp-wordmark")).toHaveAttribute(
      "data-look",
      "editorial",
    );
  });

  test("Preview as customer fills the stars and never writes a rating", async ({
    context,
    page,
  }) => {
    await openDesigner(page, { published: fixtureDesign });

    const preview = context.waitForEvent("page");
    await page.getByRole("link", { name: "Preview as customer" }).click();
    const tab = await preview;
    await tab.waitForLoadState("domcontentloaded");

    await expect(tab.getByText("Preview")).toBeVisible();
    await expect(tab.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
    await tab.getByRole("radio", { name: "5 stars", exact: true }).click();
    await expect(tab.locator(".cp-star__glyph[data-filled]")).toHaveCount(5);
    await expect(tab).toHaveURL(/\/customer-page\/preview/);
    expect(await tab.evaluate(() => window.__RB_FIXTURE_CALLS__ ?? [])).toEqual([]);
  });
});

test.describe("more than one location", () => {
  test("offers All locations, then a location of its own", async ({ page }) => {
    await openDesigner(page, { locations: "many", published: fixtureDesign });

    const scope = page.getByLabel("Editing");
    await expect(scope).toBeVisible();
    await expect(scope).toHaveValue("all");
    await expect(page.getByText("Every location uses this design")).toBeVisible();

    await scope.selectOption("loc-1");
    await expect(page.getByText("This location only.")).toBeVisible();
  });
});

test.describe("read-only", () => {
  test("shows the page and withholds the controls that would change it", async ({ page }) => {
    await openDesigner(page, { role: "viewer", published: fixtureDesign });

    await expect(page.getByText("You can see this page but not change it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change photo" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: /Bold/ })).toBeDisabled();
    await expect(phonePreview(page).locator(".cp-hero__photo")).toBeVisible();
  });
});

test.describe("a single-location business", () => {
  test("is never shown that locations exist", async ({ page }) => {
    await openDesigner(page, { locations: "one", published: fixtureDesign });
    await expect(page.getByLabel("Editing")).toHaveCount(0);
  });
});
