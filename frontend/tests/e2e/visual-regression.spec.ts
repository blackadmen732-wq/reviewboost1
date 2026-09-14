import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`@visual ${colorScheme} customer flow`, () => {
    test(`${colorScheme} rating screen`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/q/fixture-valid");
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${colorScheme}-rating.png`, { fullPage: true });
    });
  });
}
