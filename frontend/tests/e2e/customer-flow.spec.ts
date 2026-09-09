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

async function reachGoogle(page: Page, ratingIndex = 2) {
  const spokenRating = spokenRatings[ratingIndex];
  if (!spokenRating) throw new Error(`No spoken label for rating index ${ratingIndex}.`);
  await page.getByRole("radio", { name: spokenRating }).click();
  await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
}

test.describe("ReviewBoost customer flow", () => {
  test("ratings 1–5 receive the same Google DOM, styling, and geometry", async ({
    page,
  }) => {
    const snapshots: Array<{
      html: string;
      primary: { width: number; height: number; background: string };
      order: string[];
    }> = [];

    for (let ratingIndex = 0; ratingIndex < spokenRatings.length; ratingIndex += 1) {
      await openFlow(page, `fixture-valid-rating-${ratingIndex + 1}`);
      await reachGoogle(page, ratingIndex);

      const google = page.locator("[data-flow-screen='google-opportunity']");
      const primary = google.getByRole("link", { name: "Leave a Google review" });
      const box = await primary.boundingBox();
      const background = await primary.evaluate((element) => getComputedStyle(element).backgroundColor);
      snapshots.push({
        html: await google.evaluate((element) => element.outerHTML),
        primary: {
          width: Math.round(box?.width ?? 0),
          height: Math.round(box?.height ?? 0),
          background,
        },
        order: await google.locator("a, button").evaluateAll((elements) =>
          elements.map((element) => element.textContent?.trim() ?? ""),
        ),
      });

      await expect(page.getByRole("heading", { name: "Want to thank someone?" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
    }

    expect(new Set(snapshots.map(({ html }) => html)).size).toBe(1);
    expect(new Set(snapshots.map(({ primary }) => JSON.stringify(primary))).size).toBe(1);
    expect(new Set(snapshots.map(({ order }) => JSON.stringify(order))).size).toBe(1);
  });

  test("keyboard-only completion uses the radio group and preserves focus movement", async ({ page }) => {
    await openFlow(page);
    const rating = page.getByRole("radio", { name: spokenRatings[0] });
    await rating.focus();
    await page.keyboard.press("Space");
    const googleHeading = page.getByRole("heading", { name: "Thanks for sharing." });
    await expect(googleHeading).toBeVisible();
    await expect(googleHeading).toBeFocused();
  });

  test("offline submission keeps the selected star and retries after reconnect", async ({
    context,
    page,
  }) => {
    await openFlow(page);
    await context.setOffline(true);
    await page.getByRole("radio", { name: spokenRatings[0] }).click();
    await expect(page.getByText("You’re offline. We’ll try when you reconnect.")).toBeVisible();
    await expect(page.getByRole("radio", { name: spokenRatings[0] })).toBeChecked();
    await context.setOffline(false);
    await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
  });

  test("recoverable failure keeps the rating and reuses the same idempotency key", async ({ page }) => {
    await openFlow(page, "fixture-response-error");
    await page.getByRole("radio", { name: spokenRatings[1] }).click();
    await expect(page.locator("#feedback-status")).toContainText("Your feedback is still here");
    await expect(page.getByRole("radio", { name: spokenRatings[1] })).toBeChecked();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();

    const keys = await page.evaluate(() =>
      window.__RB_FIXTURE_CALLS__
        ?.filter(({ operation }) => operation === "response")
        .map(({ idempotencyKey }) => idempotencyKey),
    );
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  test("duplicate taps create one response attempt", async ({ page }) => {
    await openFlow(page);
    const star = page.getByRole("radio", { name: spokenRatings[2] });
    await star.click();
    await star.click({ force: true }).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
    const responseCount = await page.evaluate(
      () => window.__RB_FIXTURE_CALLS__?.filter(({ operation }) => operation === "response").length,
    );
    expect(responseCount).toBe(1);
  });

  test("unknown and inactive links are visually and textually indistinguishable", async ({ page }) => {
    await page.goto("/q/fixture-unknown");
    await expect(page.getByRole("heading", { name: "This review link isn’t active." })).toBeVisible();
    const unknown = await page.locator(".customer-card").innerHTML();

    await page.goto("/q/fixture-inactive");
    await expect(page.getByRole("heading", { name: "This review link isn’t active." })).toBeVisible();
    expect(await page.locator(".customer-card").innerHTML()).toBe(unknown);
  });

  test("Spanish and Haitian Creole expand without adding contact or marketing fields", async ({ page }) => {
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
    await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
  });

  test("reduced motion removes star scaling", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFlow(page);
    await page.getByRole("radio", { name: spokenRatings[3] }).click();
    const selectedLabel = page.locator(".star-option__input:checked + .star-option__label");
    await expect(selectedLabel).toHaveCSS("transform", "none");
  });
});
