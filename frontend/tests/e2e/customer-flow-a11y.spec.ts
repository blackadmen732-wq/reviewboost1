import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} customer-flow accessibility`, () => {
    test("rating, Google, Team Praise, finished, and inactive states", async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(`/q/fixture-a11y-${colorScheme}`);
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.getByRole("radio", { name: "3 stars — Good" }).click();
      await expectNoSeriousViolations(page);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.getByRole("button", { name: "Continue without Google" }).click();
      await expect(page.getByRole("heading", { name: "Want to thank someone?" })).toBeVisible();
      await expectNoSeriousViolations(page);
      await page.getByRole("button", { name: "Skip" }).click();
      await expect(page.getByRole("heading", { name: "You’re all done." })).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.goto("/q/fixture-inactive");
      await expect(page.getByRole("heading", { name: "This review link isn’t active." })).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test("loading, load error, response error, and offline states", async ({ context, page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/q/fixture-slow");
      await expect(page.locator("[aria-busy='true']")).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.goto("/q/fixture-api-error");
      await expect(page.getByRole("heading", { name: "That didn’t go through." })).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.goto("/q/fixture-response-error");
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await page.getByRole("radio", { name: "2 stars — Could be better" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.locator("#feedback-status")).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.goto(`/q/fixture-offline-a11y-${colorScheme}`);
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await page.getByRole("radio", { name: "4 stars — Great" }).click();
      await context.setOffline(true);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("You’re offline. We’ll try when you reconnect.")).toBeVisible();
      await expectNoSeriousViolations(page);
      await context.setOffline(false);
    });
  });
}
