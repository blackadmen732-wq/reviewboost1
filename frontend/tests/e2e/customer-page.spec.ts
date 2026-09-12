import { expect, test } from "@playwright/test";

import {
  alert,
  captureHandoff,
  filledStars,
  fixtureCalls,
  handoffs,
  instruction,
  openPage,
  ratings,
  sheet,
  sheetShape,
  star,
  stubGoogle,
  tap,
} from "./support/customer-page";

/**
 * The locked customer flow, in a real browser.
 *
 * Tap a star, the private rating is saved, Google opens. The component tests
 * already cover the state machine; what only a browser can settle is the part
 * that depends on the browser — a real `location.assign`, real radio-group
 * key handling, real layout at 320px, real offline.
 */

test.describe("the one tap", () => {
  test("saves the private rating and lands the customer on Google", async ({ page }) => {
    await stubGoogle(page);
    await openPage(page);

    await tap(page, 4);
    await page.waitForURL(/search\.google\.com/);
    await expect(page.getByRole("heading", { name: "Google" })).toBeVisible();
  });

  test("paints the stars before it has finished saving", async ({ page }) => {
    await captureHandoff(page);
    // Every fixture call on this token takes ~1.35s, so the gap between the tap
    // landing and the save returning is wide enough to observe.
    await openPage(page, "fixture-slow");

    await tap(page, 3);
    await expect(filledStars(page)).toHaveCount(3);
  });

  test("never opens Google before the rating is saved", async ({ page }) => {
    await captureHandoff(page);
    await openPage(page, "fixture-slow");

    await tap(page, 4);
    await expect(filledStars(page)).toHaveCount(4);
    // The save is still in flight, and nothing has been handed off yet.
    expect(await handoffs(page)).toHaveLength(0);

    await expect.poll(async () => (await handoffs(page)).length, { timeout: 15_000 }).toBe(1);

    const calls = await fixtureCalls(page);
    const saved = calls.findIndex(({ operation }) => operation === "response");
    const click = calls.findIndex(({ operation }) => operation === "google-click");
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(click).toBeGreaterThan(saved);
  });

  test("records the star the customer actually tapped", async ({ page }) => {
    await captureHandoff(page);

    for (const rating of ratings) {
      await openPage(page, `fixture-valid-rating-${rating}`);
      await tap(page, rating);
      await expect
        .poll(async () => (await handoffs(page)).at(-1) ?? null, { timeout: 15_000 })
        .toMatch(/search\.google\.com/);

      const responses = (await fixtureCalls(page)).filter(
        ({ operation }) => operation === "response",
      );
      expect(responses).toHaveLength(1);
      expect(responses[0]?.rating).toBe(rating);
    }
  });

  test("gives 1★ and 5★ the identical destination, sheet, and status", async ({ page }) => {
    await captureHandoff(page);
    const observed: Array<{ url: string; shape: string; status: string }> = [];

    for (const rating of ratings) {
      await openPage(page, `fixture-valid-rating-${rating}`);
      await tap(page, rating);
      await expect
        .poll(async () => (await handoffs(page)).at(-1) ?? null, { timeout: 15_000 })
        .toMatch(/search\.google\.com/);

      const destinations = await handoffs(page);
      observed.push({
        url: destinations.at(-1)!,
        shape: await sheetShape(page),
        status: (await instruction(page).textContent())?.trim() ?? "",
      });
    }

    expect(new Set(observed.map(({ url }) => url)).size).toBe(1);
    expect(new Set(observed.map(({ shape }) => shape)).size).toBe(1);
    expect(new Set(observed.map(({ status }) => status)).size).toBe(1);
  });

  test("a second tap on the same star does not write a second rating", async ({ page }) => {
    await captureHandoff(page);
    await openPage(page);

    await tap(page, 5);
    await expect.poll(async () => (await handoffs(page)).length, { timeout: 15_000 }).toBe(1);
    await tap(page, 5);
    await expect.poll(async () => (await handoffs(page)).length, { timeout: 15_000 }).toBe(2);

    const responses = (await fixtureCalls(page)).filter(
      ({ operation }) => operation === "response",
    );
    expect(responses).toHaveLength(1);
  });
});

/**
 * Arrow keys select on a native radio group, and Chromium fires a full `click`
 * when they do. Left alone that would send a keyboard user to Google on their
 * first arrow press — the one trap this control has to avoid — so the browser is
 * the only place this can honestly be checked.
 */
test.describe("reaching it without a pointer", () => {
  test("arrows move and paint but never hand off", async ({ page }) => {
    await captureHandoff(page);
    await openPage(page);

    await star(page, 1).focus();
    await page.keyboard.press("ArrowRight");
    await expect(star(page, 2)).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(star(page, 3)).toBeChecked();
    await expect(filledStars(page)).toHaveCount(3);

    // Nothing saved, nothing opened: they are still choosing.
    await expect(instruction(page)).toHaveText("Tap a star to continue to Google");
    const writes = (await fixtureCalls(page)).filter(({ operation }) =>
      operation === "response" || operation === "google-click",
    );
    expect(writes).toEqual([]);
    expect(await handoffs(page)).toEqual([]);
  });

  test("Enter commits the star the customer arrowed to", async ({ page }) => {
    await stubGoogle(page);
    await openPage(page);

    await star(page, 1).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.waitForURL(/search\.google\.com/);
  });

  test("Space commits too, the other key the control answers to", async ({ page }) => {
    await stubGoogle(page);
    await openPage(page);

    await star(page, 4).focus();
    await page.keyboard.press(" ");
    await page.waitForURL(/search\.google\.com/);
  });

  test("keeps a visible focus ring on the star that has focus", async ({ page }) => {
    // One language so Tab's first stop is a star, not the language pill.
    await openPage(page, "fixture-one-language");
    await page.keyboard.press("Tab");

    const focused = page.locator(".cp-star__input:focus-visible + .cp-star__label");
    await expect(focused).toHaveCount(1);
    const outline = await focused.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline.style).not.toBe("none");
    expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });
});

test.describe("when the save cannot go through", () => {
  test("keeps the stars, explains, and retries on one rating", async ({ page }) => {
    await stubGoogle(page);
    await openPage(page, "fixture-response-error");

    await tap(page, 2);
    await expect(alert(page)).toContainText("Couldn’t connect.");
    await expect(alert(page)).toContainText("Your rating is still selected.");
    await expect(filledStars(page)).toHaveCount(2);

    const keysBeforeRetry = (await fixtureCalls(page))
      .filter(({ operation }) => operation === "response")
      .map(({ idempotencyKey }) => idempotencyKey);
    expect(keysBeforeRetry).toHaveLength(1);

    await page.getByRole("button", { name: "Try again" }).click();
    await page.waitForURL(/search\.google\.com/);
  });

  test("holds an offline rating and sends it when the connection returns", async ({
    context,
    page,
  }) => {
    await stubGoogle(page);
    await openPage(page);
    await context.setOffline(true);

    await tap(page, 3);
    await expect(alert(page)).toContainText("You’re offline.");
    await expect(filledStars(page)).toHaveCount(3);

    await context.setOffline(false);
    await page.waitForURL(/search\.google\.com/);
  });

  test("still takes a rating when the business photograph fails", async ({ page }) => {
    await stubGoogle(page);
    await openPage(page, "fixture-broken-photo");

    await expect(page.locator(".cp-hero")).toBeVisible();
    await expect(page.locator(".cp-hero__photo")).toHaveCount(0);
    await expect(page.getByText("Mario’s")).toBeVisible();

    await tap(page, 5);
    await page.waitForURL(/search\.google\.com/);
  });
});

test.describe("when there is nothing to rate", () => {
  test("an unavailable Tag reads as a clean page, not a broken app", async ({ page }) => {
    await page.goto("/q/fixture-inactive");
    await expect(
      page.getByRole("heading", { name: "This Tag isn’t available." }),
    ).toBeVisible();
    await expect(page.getByText("Ask the business for help.")).toBeVisible();

    const body = page.locator("body");
    await expect(body).not.toContainText(/404|token|invalid|database|error code/i);
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("an unknown Tag is indistinguishable from a revoked one", async ({ page }) => {
    await page.goto("/q/fixture-unknown");
    await expect(
      page.getByRole("heading", { name: "This Tag isn’t available." }),
    ).toBeVisible();
    const unknown = await sheet(page).innerHTML();

    await page.goto("/q/fixture-inactive");
    await expect(
      page.getByRole("heading", { name: "This Tag isn’t available." }),
    ).toBeVisible();
    expect(await sheet(page).innerHTML()).toBe(unknown);
  });

  test("a failed load offers another go", async ({ page }) => {
    await page.goto("/q/fixture-api-error");
    await expect(page.getByRole("heading", { name: "Couldn’t connect." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

/**
 * PART 3 of the specification: the reference composition is the target, and it
 * is the part most likely to drift silently as CSS is edited. These assert the
 * proportions rather than the pixels — a screenshot catches a change, this
 * catches a change that breaks the design.
 */
test.describe("the locked composition", () => {
  test("gives the business roughly 70% and the sheet roughly 30%", async ({ page }) => {
    await openPage(page);

    // Measured against the frame, not the monitor: on a phone the frame is the
    // viewport; on a desktop it is the centred card. The proportion is the same.
    const frame = (await page.locator(".cp__frame").boundingBox())!;
    const hero = (await page.locator(".cp-hero").boundingBox())!;
    const rating = (await sheet(page).boundingBox())!;

    expect(hero.height / frame.height).toBeGreaterThan(0.6);
    expect(hero.height / frame.height).toBeLessThan(0.78);
    expect(rating.height / frame.height).toBeGreaterThan(0.24);
    // The hero starts at the top of the frame and the sheet finishes at the
    // bottom, overlapping the photograph rather than sitting in a gap below it.
    expect(hero.y).toBeLessThanOrEqual(frame.y + 1);
    expect(rating.y + rating.height).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
  });

  test("keeps the stars reachable without scrolling", async ({ page }) => {
    await openPage(page);

    const viewport = page.viewportSize()!.height;
    const row = (await page.locator(".cp-stars__row").boundingBox())!;
    expect(row.y + row.height).toBeLessThanOrEqual(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport + 1,
    );
  });

  test("gives every star a tap target big enough to hit", async ({ page }) => {
    await openPage(page);

    for (const rating of ratings) {
      const box = (await page.locator(".cp-star__label").nth(rating - 1).boundingBox())!;
      expect(box.width, `star ${rating} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `star ${rating} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test("draws no box around the stars", async ({ page }) => {
    await openPage(page);

    for (const element of [".cp-stars", ".cp-stars__row", ".cp-star", ".cp-star__label"]) {
      const box = await page.locator(element).first().evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          borderWidth: style.borderTopWidth,
          background: style.backgroundColor,
          boxShadow: style.boxShadow,
        };
      });
      expect(box.borderWidth, element).toBe("0px");
      expect(box.background, element).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(box.boxShadow, element).toBe("none");
    }
  });

  test("survives 320px with 200% text without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openPage(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const size = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(size.content).toBeLessThanOrEqual(size.viewport + 1);
    await expect(star(page, 5)).toBeEnabled();
    await expect(page.locator(".cp-stars__row")).toBeVisible();
  });

  test("does not become a 1600px website hero on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPage(page);

    const frame = (await page.locator(".cp__frame").boundingBox())!;
    expect(frame.width).toBeGreaterThanOrEqual(420);
    expect(frame.width).toBeLessThanOrEqual(560);
    // Centred on the cream canvas rather than filling the monitor. Measured
    // against the canvas, not a hardcoded 720, because a scrollbar shifts the
    // usable width by a few pixels.
    const canvas = (await page.locator(".cp").boundingBox())!;
    expect(Math.abs(frame.x + frame.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(4);

    // The warm ReviewBoost canvas, not a photograph bled to the monitor edges.
    await expect(page.locator(".cp")).toHaveCSS("background-color", "rgb(248, 245, 240)");
    const hero = (await page.locator(".cp-hero").boundingBox())!;
    expect(hero.width).toBeLessThanOrEqual(frame.width + 1);
  });

  test("stays still when the customer has asked for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await captureHandoff(page);
    await openPage(page);

    await tap(page, 4);
    const glyph = page.locator(".cp-star__glyph").nth(3);
    // The fill still changes instantly; only the movement is dropped.
    expect(await glyph.evaluate((node) => getComputedStyle(node).transitionProperty)).not.toContain(
      "transform",
    );
    await expect(page.locator(".cp-star__label").nth(3)).toHaveCSS("transform", "none");
    await expect(sheet(page)).toHaveCSS("animation-name", "none");
  });
});

test.describe("language", () => {
  test("switches the customer's words without competing with the stars", async ({ page }) => {
    await openPage(page);

    const control = page.getByRole("combobox", { name: "Language" });
    const pill = (await page.locator(".cp-language").boundingBox())!;
    const row = (await page.locator(".cp-stars__row").boundingBox())!;
    // A corner control, not a header: comfortably smaller than the star row.
    expect(pill.width * pill.height).toBeLessThan(row.width * row.height * 0.25);

    await control.selectOption("es");
    await expect(
      page.getByRole("heading", { name: "¿Cómo estuvo tu visita?" }),
    ).toBeVisible();
    await expect(instruction(page)).toHaveText("Toca una estrella para continuar a Google");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");

    await page.getByRole("combobox", { name: "Idioma" }).selectOption("ht");
    await expect(page.getByRole("heading", { name: "Kijan vizit ou te ye?" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ht");
  });

  test("hides the control when there is only one language", async ({ page }) => {
    await openPage(page, "fixture-one-language");
    await expect(page.locator(".cp-language")).toHaveCount(0);
  });

  test("saves in the language the customer chose", async ({ page }) => {
    await stubGoogle(page);
    await openPage(page);

    await page.getByRole("combobox", { name: "Language" }).selectOption("es");
    await expect(instruction(page)).toHaveText("Toca una estrella para continuar a Google");
    await page.getByRole("radio", { name: "3 estrellas", exact: true }).click();
    await page.waitForURL(/search\.google\.com/);
  });
});

test.describe("what the fast path must not contain", () => {
  test("asks for nothing but the star", async ({ page }) => {
    await openPage(page);

    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.locator("input[type='email'], input[type='tel']")).toHaveCount(0);
    await expect(page.locator("input[type='text']")).toHaveCount(0);
    // The only button-like controls are the five stars.
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("heading")).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText(
      /continue$|would you like to review|thank someone|create an account|sign in|newsletter/i,
    );
  });

  test("puts nothing between the tap and Google", async ({ page }) => {
    await stubGoogle(page);
    await openPage(page);

    await tap(page, 1);
    // No intermediate screen: the only navigation is the handoff itself.
    await page.waitForURL(/search\.google\.com/);
  });
});
