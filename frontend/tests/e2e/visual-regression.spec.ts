import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`@visual ${colorScheme} customer flow`, () => {
    test(`${colorScheme} rating, Google, and finished`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/q/fixture-valid");
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await page.getByRole("radio", { name: "4 stars — Great" }).click();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${colorScheme}-rating.png`, { fullPage: true });

      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
      await expect(page).toHaveScreenshot(`${colorScheme}-google.png`, { fullPage: true });

      await page.getByRole("button", { name: "Continue without Google" }).click();
      await expect(page.getByRole("heading", { name: "You're all done." })).toBeVisible();
      await expect(page).toHaveScreenshot(`${colorScheme}-finished.png`, { fullPage: true });
    });
  });
}
