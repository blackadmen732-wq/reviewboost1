import { expect, test, type Page } from "@playwright/test";

import { captureHandoff, filledStars, openPage, star } from "./support/customer-page";

/**
 * The reference composition, pinned.
 *
 * PART 3 of the specification makes the layout the thing that must not change:
 * the photograph and identity dominating the upper portion, the white rounded
 * sheet anchoring the lower portion, the question, the tiny instruction, five
 * free-floating stars, the small credit. Assertions can check proportions;
 * only a baseline catches a redesign.
 *
 * Light only, and deliberately: the page sets `color-scheme: light` because the
 * sheet is white at every business in every theme, so a dark baseline would
 * pin behaviour the page does not have.
 */

const looks = ["signature", "modern", "bold", "editorial", "classic", "minimal"] as const;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // The hero photograph is decoration and loads independently of the stars, so
  // it has to be waited for explicitly or the baseline catches a half-painted
  // image.
  await page.evaluate(() =>
    Promise.all(
      [...document.images].filter((image) => !image.complete).map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }),
      ),
    ),
  );
}

test.describe("@visual the customer page", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await captureHandoff(page);
  });

  test("waiting, idle, rated, and handing off", async ({ page }) => {
    await page.goto("/q/fixture-slow");
    await expect(page.locator(".cp-sheet[data-status='loading']")).toBeVisible();
    await expect(page).toHaveScreenshot("state-loading.png");

    await openPage(page);
    await settle(page);
    await expect(page).toHaveScreenshot("state-idle.png");

    await star(page, 4).focus();
    await page.keyboard.press("ArrowRight");
    await expect(filledStars(page)).toHaveCount(5);
    await expect(page).toHaveScreenshot("state-rated.png");
  });

  test("save failed and offline keep the customer's stars", async ({ context, page }) => {
    await openPage(page, "fixture-response-error");
    await settle(page);
    await star(page, 2).click();
    await expect(page.locator(".cp-sheet__alert")).toBeVisible();
    await expect(page).toHaveScreenshot("state-save-failed.png");

    await openPage(page);
    await settle(page);
    await context.setOffline(true);
    await star(page, 4).click();
    await expect(page.locator(".cp-sheet__alert")).toContainText("You’re offline.");
    await expect(page).toHaveScreenshot("state-offline.png");
    await context.setOffline(false);
  });

  test("unavailable Tag and failed load", async ({ page }) => {
    await page.goto("/q/fixture-inactive");
    await expect(page.getByRole("heading", { name: "This Tag isn’t available." })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("state-unavailable.png");

    await page.goto("/q/fixture-api-error");
    await expect(page.getByRole("heading", { name: "Couldn’t connect." })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("state-load-error.png");
  });

  test("no photograph, a failed photograph, and a name too long to be a wordmark", async ({
    page,
  }) => {
    for (const [token, name] of [
      ["fixture-no-photo", "hero-no-photo"],
      ["fixture-broken-photo", "hero-photo-failed"],
      ["fixture-long-name", "hero-long-name"],
    ] as const) {
      await openPage(page, token);
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}.png`);
    }
  });

  test("each Look composes the same identity differently", async ({ page }) => {
    for (const look of looks) {
      await openPage(page, `fixture-look-${look}`);
      await settle(page);
      // The hero alone: the sheet below it is identical by design, and clipping
      // to the hero is what makes a diff here mean the Look changed.
      await expect(page.locator(".cp-hero")).toHaveScreenshot(`look-${look}.png`);
    }
  });

  test("holds together at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openPage(page);
    await settle(page);
    await expect(page).toHaveScreenshot("narrow-320.png");
  });
});
