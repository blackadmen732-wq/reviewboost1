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

  test("a failed save never holds the customer back, and is finished under the same key on return", async ({
    page,
  }) => {
    // The fixture refuses the first request with a 503, then accepts.
    await openFlow(page, "fixture-response-error", { stayOnPage: true });
    const leaving = page.waitForRequest(DESTINATION_PATTERN);
    await page.getByRole("radio", { name: spokenRatings[1] }).click();
    // Google is opened on the tap itself, failed save or not.
    await leaving;
    await expect(page.locator("[data-flow-screen='handoff']")).toBeVisible();

    const pendingKey = () =>
      page.evaluate(() => {
        const raw = sessionStorage.getItem("reviewboost:customer-flow:fixture-response-error");
        return raw ? (JSON.parse(raw) as { pending: { key: string } | null }).pending?.key ?? null : null;
      });
    await expect.poll(pendingKey).not.toBeNull();

    // Back from Google through the back-forward cache.
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    );
    await expect.poll(pendingKey).toBeNull();

    const keys = await page.evaluate(() =>
      window.__RB_FIXTURE_CALLS__
        ?.filter(({ operation }) => operation === "rating")
        .map(({ idempotencyKey }) => idempotencyKey),
    );
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  test("Google opens on the tap itself, before the save is answered", async ({ page }) => {
    // fixture-slow answers after 1.35s; a page that waited for it would be late.
    await openFlow(page, "fixture-slow", { stayOnPage: true });
    const leaving = page.waitForRequest(DESTINATION_PATTERN);
    const tappedAt = Date.now();
    await page.getByRole("radio", { name: spokenRatings[4] }).click({ noWaitAfter: true });
    await leaving;
    expect(Date.now() - tappedAt).toBeLessThan(1000);
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

  /**
   * The bottom sheet is the approved reference, rebuilt as real UI.
   *
   * These lock what has already drifted from it once — the footer's small grey
   * bolt was swapped for the green R mark under a brand-wide change — and the
   * geometry that makes it the reference: a sheet sized by the screen's width,
   * with every line at its measured place inside it. Positions are layout
   * boxes in points from the sheet's top at a 390pt-wide screen, where the
   * reference was measured; anything at another width scales by width / 390.
   */
  test.describe("the bottom sheet matches the approved reference", () => {
    test("is 320pt tall at 390 wide, and a taller phone gets more photo, not more sheet", async ({
      page,
    }) => {
      for (const height of [844, 940]) {
        await page.setViewportSize({ width: 390, height });
        await openFlow(page, "fixture-valid", { stayOnPage: true });
        const card = await page.locator("[data-rating-card]").boundingBox();
        if (!card) throw new Error("No sheet box.");
        expect(Math.abs(card.height - 320)).toBeLessThanOrEqual(1);
        expect(Math.abs(card.y + card.height - height)).toBeLessThanOrEqual(1);
      }

      // Wider phone: the same design, scaled by width.
      await page.setViewportSize({ width: 412, height: 915 });
      await openFlow(page, "fixture-valid", { stayOnPage: true });
      const wide = await page.locator("[data-rating-card]").boundingBox();
      if (!wide) throw new Error("No sheet box.");
      expect(Math.abs(wide.height - (412 * 320) / 390)).toBeLessThanOrEqual(1);
    });

    test("places the heading, instruction, stars and footer where the reference does", async ({
      page,
    }) => {
      for (const width of [390, 412]) {
        await page.setViewportSize({ width, height: 900 });
        await openFlow(page, "fixture-valid", { stayOnPage: true });
        await page.evaluate(() => document.fonts.ready);
        const card = await page.locator("[data-rating-card]").boundingBox();
        if (!card) throw new Error("No sheet box.");
        const k = width / 390;

        for (const [selector, top] of [
          [".visit-heading", 39.3],
          [".visit-support", 84.6],
          [".visit-stars__row", 126.9],
          [".visit-powered", 252.8],
          [".visit-footer__line", 274.7],
        ] as const) {
          // Polled: the rating screen eases in from a few points lower, so the
          // settled position is the one that has to match.
          await expect
            .poll(
              async () => {
                const box = await page.locator(`[data-rating-card] ${selector}`).boundingBox();
                if (!box) throw new Error(`${selector} has no box.`);
                return Math.abs(box.y - card.y - top * k);
              },
              { message: `${selector} at ${width} wide` },
            )
            .toBeLessThanOrEqual(2);
        }
      }
    });

    test("stars are five full-cell targets with no native radio circle showing", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openFlow(page, "fixture-valid", { stayOnPage: true });

      const inputs = page.locator(".visit-star__input");
      await expect(inputs).toHaveCount(5);
      for (let index = 0; index < 5; index += 1) {
        const input = inputs.nth(index);
        await expect(input).toHaveCSS("opacity", "0");
        await expect(input).toHaveCSS("appearance", "none");
        // The invisible radio covers the whole star cell, so a thumb that lands
        // beside the glyph still rates.
        const inputBox = await input.boundingBox();
        const labelBox = await page.locator(".visit-star__label").nth(index).boundingBox();
        if (!inputBox || !labelBox) throw new Error(`Star ${index + 1} has no box.`);
        expect(Math.abs(inputBox.width - labelBox.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(inputBox.height - labelBox.height)).toBeLessThanOrEqual(1);
        expect(labelBox.width).toBeGreaterThanOrEqual(44);
      }
    });

    test("footer is the grey bolt and the exact promise line — not the green R mark", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openFlow(page, "fixture-valid", { stayOnPage: true });

      const footer = page.locator("[data-rating-card] .visit-footer");
      await expect(footer.locator("[data-powered-by]")).toHaveText("Powered by ReviewBoost");
      // Exactly one graphic, and it is the bolt: the R mark is an svg too.
      await expect(footer.locator("svg")).toHaveCount(1);
      await expect(footer.locator("svg[data-powered-bolt]")).toHaveCSS("fill", "rgb(98, 98, 98)");
      await expect(footer.locator("[data-powered-by] strong")).toHaveCSS("color", "rgb(17, 17, 17)");
      await expect(footer.locator(".visit-footer__line")).toHaveText(
        "Real businesses. Real feedback. A brighter tomorrow.",
      );
      await expect(footer.locator(".visit-footer__line")).toHaveCSS("text-transform", "uppercase");
    });

    test("with no photo, the top is plain white with nothing drawn on it", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openFlow(page, "fixture-valid", { stayOnPage: true });

      const hero = page.locator("[data-hero-layer]");
      await expect(hero).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(hero.locator("[data-hero-empty]")).toHaveCSS(
        "background-color",
        "rgb(255, 255, 255)",
      );
      // Only the language control sits there: no logo, name or placeholder art.
      await expect(hero.locator("img")).toHaveCount(0);
      await expect(hero.locator("svg:not(.visit-language svg)")).toHaveCount(0);
      await expect(hero).not.toContainText("Mario");
    });
  });

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
