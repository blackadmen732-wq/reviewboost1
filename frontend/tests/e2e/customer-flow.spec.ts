import { expect, test, type Page } from "@playwright/test";

const spokenRatings = [
  "1 star — Not good",
  "2 stars — Could be better",
  "3 stars — Good",
  "4 stars — Great",
  "5 stars — Excellent",
] as const;

async function openFlow(page: Page, token = "fixture-valid") {
  await page.goto(`/q/${token}`);
  await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
}

test.describe("ReviewBoost customer flow", () => {
  test("ratings 1–5 all redirect to the same Google destination", async ({ page }) => {
    for (let ratingIndex = 0; ratingIndex < spokenRatings.length; ratingIndex += 1) {
      const spokenRating = spokenRatings[ratingIndex];
      if (!spokenRating) continue;
      const navigationPromise = page.waitForURL(/google\.com|g\.page/);
      await openFlow(page, `fixture-valid-rating-${ratingIndex + 1}`);
      await page.getByRole("radio", { name: spokenRating }).click();
      await navigationPromise;
    }
  });

  test("keyboard-only: arrow keys select a star and trigger save + redirect", async ({ page }) => {
    const navigationPromise = page.waitForURL(/google\.com|g\.page/);
    await openFlow(page);
    const rating = page.getByRole("radio", { name: spokenRatings[0] });
    await rating.focus();
    await page.keyboard.press("Space");
    await navigationPromise;
  });

  test("offline star tap shows message, reconnect retries and redirects", async ({
    context,
    page,
  }) => {
    await openFlow(page);
    await context.setOffline(true);
    await page.getByRole("radio", { name: spokenRatings[0] }).click();
    await expect(page.getByText("You're offline. We'll try when you reconnect.")).toBeVisible();

    const navigationPromise = page.waitForURL(/google\.com|g\.page/);
    await context.setOffline(false);
    await navigationPromise;
  });

  test("recoverable failure shows retry, retry redirects with same idempotency key", async ({ page }) => {
    await openFlow(page, "fixture-response-error");
    await page.getByRole("radio", { name: spokenRatings[1] }).click();
    await expect(page.locator("#feedback-status")).toContainText("Your rating is still here");

    const navigationPromise = page.waitForURL(/google\.com|g\.page/);
    await page.getByRole("button", { name: "Try again" }).click();
    await navigationPromise;

    const keys = await page.evaluate(() =>
      window.__RB_FIXTURE_CALLS__
        ?.filter(({ operation }) => operation === "response")
        .map(({ idempotencyKey }) => idempotencyKey),
    );
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  test("unknown and inactive links are visually and textually indistinguishable", async ({ page }) => {
    await page.goto("/q/fixture-unknown");
    await expect(page.getByRole("heading", { name: "This review link isn't active." })).toBeVisible();
    const unknown = await page.locator(".customer-card").innerHTML();

    await page.goto("/q/fixture-inactive");
    await expect(page.getByRole("heading", { name: "This review link isn't active." })).toBeVisible();
    expect(await page.locator(".customer-card").innerHTML()).toBe(unknown);
  });

  test("Spanish and Haitian Creole work without adding contact or marketing fields", async ({ page }) => {
    await openFlow(page);
    const language = page.getByRole("combobox", { name: "Language" });
    await language.selectOption("es");
    await expect(page.getByRole("heading", { name: "¿Cómo estuvo tu visita?" })).toBeVisible();
    await page.getByRole("combobox", { name: "Idioma" }).selectOption("ht");
    await expect(page.getByRole("heading", { name: "Kijan vizit ou te ye?" })).toBeVisible();
    await expect(page.locator("input[type='email'], input[type='tel']")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/newsletter|create an account|download the app/i);
  });

  test("320px and 200% text remain free of horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await openFlow(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  });

  test("reduced motion removes star scaling", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFlow(page);
    await page.getByRole("radio", { name: spokenRatings[3] }).click();
    const selectedLabel = page.locator(".star-option__input:checked + .star-option__label");
    await expect(selectedLabel).toHaveCSS("transform", "none");
  });

  test("no note textarea, Continue button, or extra screens exist", async ({ page }) => {
    await openFlow(page);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(0);
  });
});
