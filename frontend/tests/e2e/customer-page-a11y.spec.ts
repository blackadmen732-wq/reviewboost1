import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  alert,
  captureHandoff,
  filledStars,
  instruction,
  openPage,
  ratings,
  star,
} from "./support/customer-page";

/**
 * The customer never opted in to this page and cannot be asked to work at it.
 *
 * The component suite runs Axe against rendered React; this runs it against the
 * page a phone actually loads — real fonts, real cascade, real contrast against
 * the photograph — in every state a customer can end up in.
 */

async function expectNoSeriousViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(blocking, `${state}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test.describe("customer page accessibility", () => {
  test("is clean while waiting, choosing, and after a rating is taken", async ({ page }) => {
    await captureHandoff(page);

    await page.goto("/q/fixture-slow");
    await expect(page.locator(".cp-sheet[data-status='loading']")).toBeVisible();
    await expectNoSeriousViolations(page, "loading");

    await openPage(page);
    await expectNoSeriousViolations(page, "idle");

    await star(page, 3).focus();
    await page.keyboard.press("ArrowRight");
    await expect(filledStars(page)).toHaveCount(4);
    await expectNoSeriousViolations(page, "selected");

    await star(page, 4).press("Enter");
    await expect(instruction(page)).toHaveText(/Opening Google…|Rating saved\./);
    await expectNoSeriousViolations(page, "handing off");
  });

  test("is clean when something has gone wrong", async ({ context, page }) => {
    await captureHandoff(page);

    await page.goto("/q/fixture-inactive");
    await expect(page.getByRole("heading", { name: "This Tag isn’t available." })).toBeVisible();
    await expectNoSeriousViolations(page, "unavailable tag");

    await page.goto("/q/fixture-api-error");
    await expect(page.getByRole("heading", { name: "Couldn’t connect." })).toBeVisible();
    await expectNoSeriousViolations(page, "load error");

    await openPage(page, "fixture-response-error");
    await star(page, 2).click();
    await expect(alert(page)).toBeVisible();
    await expectNoSeriousViolations(page, "save failed");

    await openPage(page, "fixture-offline-a11y");
    await context.setOffline(true);
    await star(page, 4).click();
    await expect(alert(page)).toContainText("You’re offline.");
    await expectNoSeriousViolations(page, "offline");
    await context.setOffline(false);
  });

  test("is clean when the business has no photograph, and when it fails", async ({ page }) => {
    await openPage(page, "fixture-no-photo");
    await expectNoSeriousViolations(page, "no photograph");

    await openPage(page, "fixture-broken-photo");
    await expectNoSeriousViolations(page, "photograph failed");

    await openPage(page, "fixture-long-name");
    await expectNoSeriousViolations(page, "long business name");
  });

  test("is clean in Spanish and Haitian Creole", async ({ page }) => {
    await openPage(page);

    for (const [locale, heading] of [
      ["es", "¿Cómo estuvo tu visita?"],
      ["ht", "Kijan vizit ou te ye?"],
    ] as const) {
      await page.locator(".cp-language__select").selectOption(locale);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectNoSeriousViolations(page, `locale ${locale}`);
    }
  });

  test("announces the stars as one group of five choices", async ({ page }) => {
    await openPage(page);

    const group = page.getByRole("radiogroup", {
      name: "Rate your visit from 1 to 5 stars",
    });
    await expect(group).toBeVisible();
    await expect(group.getByRole("radio")).toHaveCount(5);

    for (const rating of ratings) {
      await expect(star(page, rating)).toHaveCount(1);
    }
    // The rating is never carried by an image or by colour alone.
    await expect(page.locator(".cp-star svg[aria-hidden='true']")).toHaveCount(5);
  });

  test("keeps every state's copy inside a live region the customer will hear", async ({ page }) => {
    await captureHandoff(page);
    await openPage(page, "fixture-response-error");

    await expect(instruction(page)).toHaveAttribute("role", "status");
    await expect(instruction(page)).toHaveAttribute("aria-live", "polite");

    await star(page, 2).click();
    await expect(alert(page)).toHaveAttribute("role", "alert");
  });

  test("meets contrast on the sheet's own text", async ({ page }) => {
    await openPage(page);

    const results = await new AxeBuilder({ page })
      .include(".cp-sheet")
      .withTags(["wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
