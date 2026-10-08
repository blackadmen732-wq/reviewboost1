import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const DESTINATION_PATTERN = "https://search.google.com/**";

/**
 * Answer the destination with 204 so the browser makes the navigation and then
 * discards it, leaving the handoff on screen for Axe to inspect.
 */
async function stayOnHandoff(page: Page) {
  await page.route(DESTINATION_PATTERN, (route) => route.fulfill({ status: 204 }));
}

/**
 * The page eases its lines in over a few hundred milliseconds. Axe measures
 * contrast on whatever frame it lands on, and half-faded text is not what a
 * customer reads, so it waits for every entrance to finish. Looping
 * indicators (the progress bar, a loading shimmer) never finish and are left
 * running.
 */
async function settle(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}

async function expectNoSeriousViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} customer-flow accessibility`, () => {
    test("rating, handoff, and inactive states", async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      // Held on the handoff rather than followed to Google, so Axe can read it.
      await stayOnHandoff(page);

      await page.goto(`/q/fixture-a11y-${colorScheme}`);
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.getByRole("radio", { name: "3 stars — Good" }).click();
      await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.goto("/q/fixture-inactive");
      await expect(page.getByRole("heading", { name: "This review link isn’t active." })).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test("loading, load error, failed save, and offline states", async ({ context, page }) => {
      await page.emulateMedia({ colorScheme });
      await stayOnHandoff(page);

      await page.goto("/q/fixture-slow");
      await expect(page.locator("[aria-busy='true']")).toBeVisible();
      await expectNoSeriousViolations(page);

      await page.goto("/q/fixture-api-error");
      await expect(page.getByRole("heading", { name: "That didn’t go through." })).toBeVisible();
      await expectNoSeriousViolations(page);

      // A failed save is invisible to the customer, who is already on the way
      // to Google: the handoff is what stays on screen.
      await page.goto("/q/fixture-response-error");
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await page.getByRole("radio", { name: "2 stars — Could be better" }).click();
      await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
      await expectNoSeriousViolations(page);

      await context.setOffline(true);
      await page.goto(`/q/fixture-offline-a11y-${colorScheme}`, { waitUntil: "commit" }).catch(() => {});
      await context.setOffline(false);
      await page.goto(`/q/fixture-offline-a11y-${colorScheme}`);
      await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
      await context.setOffline(true);
      await page.getByRole("radio", { name: "4 stars — Great" }).click();
      await expect(page.getByText("You’re offline. We’ll try when you reconnect.")).toBeVisible();
      await expectNoSeriousViolations(page);
      await context.setOffline(false);
    });
  });
}
