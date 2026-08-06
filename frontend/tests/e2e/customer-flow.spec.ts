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
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
}

test.describe("ReviewBoost customer flow", () => {
  test("ratings 1–5 receive the same Google DOM, styling, geometry, and Team Praise", async ({
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

      await google.getByRole("button", { name: "Continue without Google" }).click();
      await expect(page.getByRole("heading", { name: "Want to thank someone?" })).toBeVisible();
      await expect(page.locator("[data-flow-screen='team-praise']")).not.toContainText(
        /rating|google|bonus|payroll|reward|ranking/i,
      );
    }

    expect(new Set(snapshots.map(({ html }) => html)).size).toBe(1);
    expect(new Set(snapshots.map(({ primary }) => JSON.stringify(primary))).size).toBe(1);
    expect(new Set(snapshots.map(({ order }) => JSON.stringify(order))).size).toBe(1);
  });

  test("keyboard-only completion uses the radio group and preserves focus movement", async ({ page }) => {
    await openFlow(page);
    const rating = page.getByRole("radio", { name: spokenRatings[0] });
    await rating.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: spokenRatings[1] })).toBeChecked();
    await page.getByRole("textbox", { name: /want to add a note/i }).fill("Keyboard note");
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    const googleHeading = page.getByRole("heading", { name: "Thanks for sharing." });
    await expect(googleHeading).toBeFocused();
    await page.getByRole("button", { name: "Continue without Google" }).press("Enter");
    await expect(page.getByRole("heading", { name: "Want to thank someone?" })).toBeFocused();
    await page.getByRole("button", { name: "Skip" }).press("Enter");
    await expect(page.getByRole("heading", { name: "You’re all done." })).toBeFocused();
  });

  test("offline submission keeps the private note and retries after reconnect", async ({
    context,
    page,
  }) => {
    await openFlow(page);
    await page.getByRole("radio", { name: spokenRatings[0] }).click();
    const note = page.getByRole("textbox", { name: /want to add a note/i });
    await note.fill("Please keep this note");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("You’re offline. We’ll try when you reconnect.")).toBeVisible();
    await expect(note).toHaveValue("Please keep this note");
    await context.setOffline(false);
    await expect(page.getByRole("heading", { name: "Thanks for sharing." })).toBeVisible();
  });

  test("recoverable failure keeps content and reuses the same idempotency key", async ({ page }) => {
    await openFlow(page, "fixture-response-error");
    await page.getByRole("radio", { name: spokenRatings[1] }).click();
    const note = page.getByRole("textbox", { name: /want to add a note/i });
    await note.fill("Retained after failure");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("#feedback-status")).toContainText("Your feedback is still here");
    await expect(note).toHaveValue("Retained after failure");
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
    await page.getByRole("radio", { name: spokenRatings[2] }).click();
    await page.getByRole("button", { name: "Continue" }).dblclick();
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
    await page.getByRole("radio", { name: spokenRatings[4] }).click();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  });

  test("reduced motion removes star scaling and content movement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFlow(page);
    await page.getByRole("radio", { name: spokenRatings[3] }).click();
    const selectedLabel = page.locator(".star-option__input:checked + .star-option__label");
    await expect(selectedLabel).toHaveCSS("transform", "none");
    await expect(page.locator("[data-rating-note]")).toHaveCSS("animation-name", "none");
  });
});
