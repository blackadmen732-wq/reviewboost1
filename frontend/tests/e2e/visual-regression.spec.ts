import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`@visual ${colorScheme} customer flow`, () => {
    test(`${colorScheme} rating and handoff`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      // 204 makes the browser perform the navigation and then discard it, so
      // the handoff stays on screen to be photographed.
      await page.route("https://search.google.com/**", (route) => route.fulfill({ status: 204 }));

      await page.goto("/q/fixture-valid");
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${colorScheme}-rating.png`, { fullPage: true });

      await page.getByRole("radio", { name: "4 stars — Great" }).click();
      await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
      await expect(page).toHaveScreenshot(`${colorScheme}-handoff.png`, { fullPage: true });
    });
  });
}
