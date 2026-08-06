import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test("rating, Google, Team Praise, finished, and inactive states have no serious Axe violations", async ({
  page,
}) => {
  await page.goto("/q/fixture-valid");
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
