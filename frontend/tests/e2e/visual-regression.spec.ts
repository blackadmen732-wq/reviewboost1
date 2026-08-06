import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`@visual ${colorScheme} customer flow`, () => {
    test(`${colorScheme} rating, Google, Team Praise, and finished`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/q/fixture-valid");
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await page.getByRole("radio", { name: "4 stars — Great" }).click();
      await page.getByRole("textbox", { name: /want to add a note/i }).fill(
        "The team made our visit feel easy.",
      );
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${colorScheme}-rating.png`, { fullPage: true });

      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
      await expect(page).toHaveScreenshot(`${colorScheme}-google.png`, { fullPage: true });

      await page.getByRole("button", { name: "Continue without Google" }).click();
      await expect(page.getByRole("heading", { name: "Want to thank someone?" })).toBeVisible();
      await page.getByRole("textbox", { name: /their first name/i }).fill("Ana");
      await page.getByRole("textbox", { name: /what did they do well/i }).fill(
        "She noticed every detail.",
      );
      await expect(page).toHaveScreenshot(`${colorScheme}-team-praise.png`, { fullPage: true });

      await page.getByRole("button", { name: "Skip" }).click();
      await expect(page.getByRole("heading", { name: "You’re all done." })).toBeVisible();
      await expect(page).toHaveScreenshot(`${colorScheme}-finished.png`, { fullPage: true });
    });
  });
}

