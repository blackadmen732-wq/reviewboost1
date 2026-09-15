import { expect, test, type Page } from "@playwright/test";

const spokenRatings = [
  "1 star — Not good",
  "2 stars — Could be better",
  "3 stars — Good",
  "4 stars — Great",
  "5 stars — Excellent",
] as const;

const DESTINATION_PATTERN = "https://search.google.com/**";

/**
 * The public review destination is intercepted, never suppressed.
 *
 * The browser really navigates — that is the behaviour under test — it just
 * lands on a stub instead of Google. `stayOnPage` answers it with 204, which a
 * browser treats as "nothing to display": the navigation is genuinely made and
 * genuinely discarded, leaving the handoff on screen where a test can read it.
 * While a navigation is pending, nothing can inspect the old document, so this
 * is the only way to assert on both the departure and the screen behind it.
 */
async function openFlow(
  page: Page,
  token = "fixture-valid",
  { stayOnPage = false }: { stayOnPage?: boolean } = {},
) {
  await page.route(DESTINATION_PATTERN, (route) =>
    stayOnPage
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<html><body><h1>Public review destination</h1></body></html>",
        }),
  );
  await page.goto(`/q/${token}`);
  await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
}

test.describe("ReviewBoost customer flow", () => {
  test("every rating 1–5 lands on the same destination with no step in between", async ({
    page,
  }) => {
    const landings: string[] = [];

    for (let ratingIndex = 0; ratingIndex < spokenRatings.length; ratingIndex += 1) {
      const spokenRating = spokenRatings[ratingIndex];
      if (!spokenRating) throw new Error(`No spoken label for index ${ratingIndex}.`);

      await openFlow(page, `fixture-valid-rating-${ratingIndex + 1}`);
      await page.getByRole("radio", { name: spokenRating }).click();

      await page.waitForURL(DESTINATION_PATTERN);
      await expect(
        page.getByRole("heading", { name: "Public review destination" }),
      ).toBeVisible();
      landings.push(page.url());
    }

    expect(new Set(landings).size).toBe(1);
  });

  test("the handoff screen is identical for every rating", async ({ page }) => {
    const markup: string[] = [];

    for (let ratingIndex = 0; ratingIndex < spokenRatings.length; ratingIndex += 1) {
      const spokenRating = spokenRatings[ratingIndex];
      if (!spokenRating) throw new Error(`No spoken label for index ${ratingIndex}.`);

      await openFlow(page, `fixture-handoff-rating-${ratingIndex + 1}`, {
        stayOnPage: true,
      });
      await page.getByRole("radio", { name: spokenRating }).click();

      const handoff = page.locator("[data-flow-screen='handoff']");
      await expect(handoff).toBeVisible();
      markup.push(await handoff.evaluate((element) => element.outerHTML));
    }

    expect(new Set(markup).size).toBe(1);
  });

  test("keyboard-only rating reaches the destination without a confirm control", async ({
    page,
  }) => {
    await openFlow(page);
    await page.getByRole("radio", { name: spokenRatings[0] }).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForURL(DESTINATION_PATTERN);
    await expect(
      page.getByRole("heading", { name: "Public review destination" }),
    ).toBeVisible();
  });

  test("offline rating is held and submitted after reconnect", async ({ context, page }) => {
    await openFlow(page);
    await context.setOffline(true);
    await page.getByRole("radio", { name: spokenRatings[0] }).click();
    await expect(page.getByText("You’re offline. We’ll try when you reconnect.")).toBeVisible();

    await context.setOffline(false);
    await page.waitForURL(DESTINATION_PATTERN);
  });

  test("recoverable failure keeps the rating and reuses the same idempotency key", async ({
    page,
  }) => {
    await openFlow(page, "fixture-response-error", { stayOnPage: true });
    await page.getByRole("radio", { name: spokenRatings[1] }).click();
    await expect(page.locator("#feedback-status")).toContainText("Your rating is still here");

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("[data-flow-screen='handoff']")).toBeVisible();

    const keys = await page.evaluate(() =>
      window.__RB_FIXTURE_CALLS__
        ?.filter(({ operation }) => operation === "response")
        .map(({ idempotencyKey }) => idempotencyKey),
    );
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  test("unknown and inactive links are visually and textually indistinguishable", async ({
    page,
  }) => {
    await page.goto("/q/fixture-unknown");
    await expect(page.getByRole("heading", { name: "This review link isn’t active." })).toBeVisible();
    const unknown = await page.locator(".customer-card").innerHTML();

    await page.goto("/q/fixture-inactive");
    await expect(page.getByRole("heading", { name: "This review link isn’t active." })).toBeVisible();
    expect(await page.locator(".customer-card").innerHTML()).toBe(unknown);
  });

  test("Spanish and Haitian Creole expand without adding contact or marketing fields", async ({
    page,
  }) => {
    await openFlow(page);
    const language = page.getByRole("combobox", { name: "Language" });
    await language.selectOption("es");
    await expect(page.getByRole("heading", { name: "¿Cómo estuvo tu visita?" })).toBeVisible();
    await page.getByRole("combobox", { name: "Idioma" }).selectOption("ht");
    await expect(page.getByRole("heading", { name: "Kijan vizit ou te ye?" })).toBeVisible();
    await expect(page.locator("input[type='email'], input[type='tel']")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      /newsletter|create an account|download the app/i,
    );
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
    await expect(page.getByRole("radio", { name: spokenRatings[4] })).toBeAttached();
  });

  test("reduced motion removes star scaling and content movement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFlow(page, "fixture-valid", { stayOnPage: true });
    await page.getByRole("radio", { name: spokenRatings[3] }).click();
    const selectedLabel = page.locator(".star-option__input:checked + .star-option__label");
    await expect(selectedLabel).toHaveCSS("transform", "none");
  });
});
