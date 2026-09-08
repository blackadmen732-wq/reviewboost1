import { expect, type Locator, type Page, type Request } from "@playwright/test";

/**
 * The pieces every customer-page spec needs, in one place.
 *
 * All of them exist because of one awkward fact about testing this page: the
 * happy path ends by leaving it. `location.assign` to Google is the last thing a
 * successful tap does, and a real navigation takes the page — and with it the
 * fixture call log — out from under the assertions.
 *
 * So the destination is intercepted, two ways. `stubGoogle` answers with a
 * stand-in page, which is how a spec proves the customer actually arrives.
 * `blockGoogle` refuses the navigation and records the attempt, which keeps the
 * customer page alive so what happened before the handoff can still be read.
 */

export const ratings = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof ratings)[number];

const spoken: Record<Rating, string> = {
  1: "1 star",
  2: "2 stars",
  3: "3 stars",
  4: "4 stars",
  5: "5 stars",
};

const googlePattern = /^https:\/\/search\.google\.com\/local\/writereview/;

export interface FixtureCall {
  operation: string;
  idempotencyKey?: string;
  rating?: number;
}

/** Answers the Google navigation, so the spec can assert the customer got there. */
export async function stubGoogle(page: Page): Promise<void> {
  await page.route(googlePattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html lang='en'><title>Write a review</title><body><h1>Google</h1></body></html>",
    }),
  );
}

/**
 * Refuses the Google navigation and records every attempt.
 *
 * Aborting keeps the customer page mounted, which is the only way to inspect the
 * fixture call log and the sheet as they were at the moment of handoff.
 */
export async function blockGoogle(page: Page): Promise<Request[]> {
  const attempts: Request[] = [];
  await page.route(googlePattern, (route) => {
    attempts.push(route.request());
    return route.abort();
  });
  return attempts;
}

export function star(page: Page, rating: Rating): Locator {
  return page.getByRole("radio", { name: spoken[rating], exact: true });
}

export function filledStars(page: Page): Locator {
  return page.locator(".cp-star__glyph[data-filled]");
}

export function sheet(page: Page): Locator {
  return page.locator(".cp-sheet");
}

export function instruction(page: Page): Locator {
  return page.locator(".cp-sheet__instruction");
}

export function alert(page: Page): Locator {
  return page.locator(".cp-sheet__alert");
}

/** Opens a token and waits until a tap would actually be accepted. */
export async function openPage(page: Page, token = "fixture-valid"): Promise<void> {
  await page.goto(`/q/${token}`);
  await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
  await expect(star(page, 1)).toBeEnabled();
}

export async function tap(page: Page, rating: Rating): Promise<void> {
  await star(page, rating).click();
}

export async function fixtureCalls(page: Page): Promise<FixtureCall[]> {
  return page.evaluate(() => window.__RB_FIXTURE_CALLS__ ?? []);
}

/**
 * The sheet's markup with the selection erased.
 *
 * Which stars are gold is the one thing that is *supposed* to differ between a
 * 1★ and a 5★ tap. Removing it leaves the part that must not differ, so a spec
 * can compare two ratings and fail on anything else.
 */
export async function sheetShape(page: Page): Promise<string> {
  return sheet(page).evaluate((element) =>
    element.outerHTML.replace(/\s*data-filled="true"/g, ""),
  );
}
