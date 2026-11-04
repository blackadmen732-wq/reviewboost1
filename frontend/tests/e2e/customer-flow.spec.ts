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
  test("the empty hero and reference footer are consistent in both themes", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await openFlow(page);
      await expect(page.locator("[data-hero-empty]")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(page.locator("[data-powered-bolt]")).toHaveCSS("fill", "rgb(98, 98, 98)");
      await expect(page.locator("[data-powered-by] strong")).toHaveText("ReviewBoost");
    }
  });

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
    // Arrows move between stars and choose nothing (WCAG 3.2.2): pressing → used
    // to send 2 stars to Google. Space chooses the focused star.
    const start = page.url();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: spokenRatings[3] })).toBeFocused();
    expect(page.url()).toBe(start);
    // The focused star and those before it fill, so the rating about to be
    // sent is seen, not counted; the fifth stays empty.
    const starFills = page.locator(".visit-star__label svg");
    for (let index = 0; index < 4; index += 1) {
      await expect(starFills.nth(index)).toHaveCSS("fill", "rgb(245, 180, 34)");
    }
    await expect(starFills.nth(4)).toHaveCSS("fill", "rgb(246, 246, 246)");
    await page.keyboard.press("Space");
    await page.waitForURL(DESTINATION_PATTERN);
    await expect(
      page.getByRole("heading", { name: "Public review destination" }),
    ).toBeVisible();
  });

  /**
   * "Sending…" used to join the sheet's flow, under a 30px gap, in a sheet of
   * fixed height with no room left: the footer was pushed past the bottom and
   * clipped, which a blind tester caught mid-send. It now sits in the space
   * above the footer, and the stars do not move under the thumb.
   */
  test("sending keeps the stars still and the footer on the sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await openFlow(page, "fixture-slow", { stayOnPage: true });
    const before = await page.locator(".visit-stars").boundingBox();

    await page.getByRole("radio", { name: spokenRatings[3] }).click();
    const sending = page.getByText("Sending…");
    await expect(sending).toBeVisible();

    const [stars, status, footer, card] = await Promise.all([
      page.locator(".visit-stars").boundingBox(),
      sending.boundingBox(),
      page.locator(".visit-footer").boundingBox(),
      page.locator(".visit-card").boundingBox(),
    ]);
    if (!before || !stars || !status || !footer || !card) throw new Error("Missing a box.");
    expect(stars.y).toBeCloseTo(before.y, 0);
    expect(status.y).toBeGreaterThanOrEqual(stars.y + stars.height);
    expect(status.y + status.height).toBeLessThanOrEqual(footer.y + 1);
    expect(footer.y + footer.height).toBeLessThanOrEqual(card.y + card.height + 1);
  });

  test("offline rating is held and submitted after reconnect", async ({ context, page }) => {
    await openFlow(page);
    await context.setOffline(true);
    await page.getByRole("radio", { name: spokenRatings[0] }).click();
    await expect(page.getByText("You’re offline. We’ll try when you reconnect.")).toBeVisible();
    // Two lines of notice grow the sheet into the artwork; the footer stays on it.
    const [footer, card] = await Promise.all([
      page.locator(".visit-footer").boundingBox(),
      page.locator(".visit-card").boundingBox(),
    ]);
    if (!footer || !card) throw new Error("Missing a box.");
    expect(footer.y + footer.height).toBeLessThanOrEqual(card.y + card.height + 1);

    await context.setOffline(false);
    await page.waitForURL(DESTINATION_PATTERN);
  });

  test("recoverable failure keeps the rating and reuses the same idempotency key", async ({
    page,
  }) => {
    await openFlow(page, "fixture-response-error", { stayOnPage: true });
    await page.getByRole("radio", { name: spokenRatings[1] }).click();
    await expect(page.locator("#feedback-status")).toContainText("Your rating is still here");
    // It would go again by itself in 3 s; "Try now" skips the wait.
    await expect(page.locator("#feedback-status")).toContainText(/Trying again in \d+ s\./);

    await page.getByRole("button", { name: "Try now" }).click();
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
    // The whole customer panel, which the closed-link screen now shares with
    // the rating screen.
    const unknown = await page.locator("[data-customer-visit]").innerHTML();

    await page.goto("/q/fixture-inactive");
    await expect(page.getByRole("heading", { name: "This review link isn’t active." })).toBeVisible();
    expect(await page.locator("[data-customer-visit]").innerHTML()).toBe(unknown);
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

  /**
   * The customer page fills the phone, and all five stars are on it.
   *
   * The live stage used to carry the preview's 390/844 canvas, so any viewport
   * shorter than 844px — every phone, once the URL bar takes its cut — kept the
   * ratio by shrinking its width. That left white bars down both sides and
   * pushed the fifth star off the card. Only a real browser at a real phone
   * size catches it, so it is checked here, where CI runs it.
   */
  for (const [label, width, height] of [
    ["small", 320, 568],
    ["common", 390, 664],
    ["large", 430, 745],
  ] as const) {
    test(`fills the viewport and shows five stars on a ${label} phone`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openFlow(page, "fixture-valid", { stayOnPage: true });

      const stage = page.locator(".visit-stage");
      const stageBox = await stage.boundingBox();
      if (!stageBox) throw new Error("No stage box.");
      // Edge to edge: no letterboxing.
      expect(stageBox.x).toBeLessThanOrEqual(1);
      expect(stageBox.width).toBeGreaterThanOrEqual(width - 1);

      const stars = page.locator(".visit-star__label");
      await expect(stars).toHaveCount(5);

      const card = await page.locator(".visit-card").boundingBox();
      if (!card) throw new Error("No card box.");
      for (let index = 0; index < 5; index += 1) {
        const star = await stars.nth(index).boundingBox();
        if (!star) throw new Error(`Star ${index + 1} has no box.`);
        expect(star.x).toBeGreaterThanOrEqual(card.x - 1);
        expect(star.x + star.width).toBeLessThanOrEqual(card.x + card.width + 1);
        // Still a thumb-sized target after scaling down.
        expect(star.width).toBeGreaterThanOrEqual(44);
      }
    });
  }

  /**
   * The fallback link is the whole point of the handoff screen.
   *
   * If the automatic redirect does not fire — a blocked popup, a slow network,
   * a browser that declines the navigation — this link is how the customer
   * still reaches the review page. It was being clipped by the fixed 44% card,
   * so on a phone it existed but could not be tapped.
   */
  for (const [label, width, height] of [
    ["small", 320, 568],
    ["common", 390, 664],
  ] as const) {
    test(`handoff keeps the review link reachable on a ${label} phone`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openFlow(page, "fixture-valid", { stayOnPage: true });
      await page.getByRole("radio", { name: spokenRatings[2] }).click();

      await expect(page.locator("[data-flow-screen='handoff']")).toBeVisible();
      const link = page.getByRole("link", { name: /open the review page/i });
      await expect(link).toBeVisible();

      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      if (!box) throw new Error("Fallback link has no box.");
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    });
  }

  test("reduced motion removes star scaling and content movement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFlow(page, "fixture-valid", { stayOnPage: true });

    // The customer page renders the Mario stars, so this is checked on those.
    // The old selector named `.star-option__label`, which this page no longer
    // renders — it passed by matching nothing.
    const chosen = page.locator(".visit-star__input:checked + .visit-star__label");
    const anyStar = page.locator(".visit-star__label").first();
    await expect(anyStar).toHaveCSS("transform", "none");

    await page.getByRole("radio", { name: spokenRatings[3] }).click();
    await expect(chosen).toHaveCSS("transform", "none");
    await expect(page.locator("[data-flow-screen='handoff']")).toBeVisible();
  });
});
