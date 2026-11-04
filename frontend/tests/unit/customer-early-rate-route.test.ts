import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * POST /q/{token}/rate: a star chosen before the page's JavaScript loaded.
 *
 * What it must guarantee: the rating is saved before the customer leaves;
 * every rating goes to the same destination; one page view (one key) is one
 * rating however often it is sent; a handoff-record failure never keeps a
 * customer from Google; and a save failure brings them back with their star.
 */

const DESTINATION = "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";
const TOKEN = "tok_0123456789abcdefghij";
const KEY = "0123456789abcdef0123456789abcdef";

const calls: Array<{ op: string; input?: unknown }> = [];
let failAt: "context" | "session" | "response" | "destination" | "inactive" | null = null;

vi.mock("@/lib/server/customer-flow-service", async () => {
  const { ApiError, ERROR_CODE } = await import("@/lib/server/errors");
  const maybeFail = (op: string) => {
    if (failAt === "inactive" && op === "context") throw new ApiError(404, ERROR_CODE.reviewLinkInactive, "inactive");
    if (failAt === op) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "down");
  };
  return {
    getContext: vi.fn(async () => {
      calls.push({ op: "context" });
      maybeFail("context");
      return { destination: { provider: "google", url: DESTINATION } };
    }),
    createSession: vi.fn(async (_token: string, input: unknown) => {
      calls.push({ op: "session", input });
      maybeFail("session");
      return { status: 201, body: { sessionId: "session-1" } };
    }),
    submitResponse: vi.fn(async (_token: string, input: unknown) => {
      calls.push({ op: "response", input });
      maybeFail("response");
      return { status: 201, body: { responseId: "response-1" } };
    }),
    recordDestinationSelection: vi.fn(async (_token: string, input: unknown) => {
      calls.push({ op: "destination", input });
      maybeFail("destination");
      return { status: 204, body: null };
    }),
  };
});

import { NextRequest } from "next/server";

import { POST } from "@/app/(customer)/q/[token]/rate/route";

function post(fields: Record<string, string>, token = TOKEN) {
  const body = new URLSearchParams(fields);
  const request = new NextRequest(`https://reviewboost.fit/q/${token}/rate`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.9" },
    body: body.toString(),
  });
  return POST(request, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  calls.length = 0;
  failAt = null;
});

describe("rating before the JavaScript loaded", () => {
  it("saves the session, the rating and the handoff, then sends the customer to Google in one trip", async () => {
    const response = await post({ "visit-rating": "2", locale: "es", key: KEY });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(DESTINATION);
    expect(calls.map((call) => call.op)).toEqual(["context", "session", "response", "destination"]);
    expect(calls[1]!.input).toEqual({ locale: "es", idempotencyKey: `${KEY}.session` });
    expect(calls[2]!.input).toEqual({ sessionId: "session-1", rating: 2, idempotencyKey: `${KEY}.response` });
  });

  it("sends every rating, one to five, to the same place", async () => {
    for (const rating of ["1", "2", "3", "4", "5"]) {
      const response = await post({ "visit-rating": rating, locale: "en", key: KEY });
      expect(response.headers.get("location")).toBe(DESTINATION);
    }
  });

  it("brings the customer back with their star when the rating could not be saved", async () => {
    failAt = "response";
    const response = await post({ "visit-rating": "4", locale: "en", key: KEY });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(`/q/${TOKEN}`);
    expect(location.searchParams.get("retry")).toBe("1");
    expect(location.searchParams.get("rating")).toBe("4");
  });

  it("still sends the customer to Google when only the handoff record fails", async () => {
    failAt = "destination";
    const response = await post({ "visit-rating": "5", locale: "en", key: KEY });
    expect(response.headers.get("location")).toBe(DESTINATION);
  });

  it("returns to the neutral page for an inactive link, saving nothing", async () => {
    failAt = "inactive";
    const response = await post({ "visit-rating": "3", locale: "en", key: KEY });
    expect(new URL(response.headers.get("location")!).search).toBe("");
    expect(calls.map((call) => call.op)).toEqual(["context"]);
  });

  it("refuses a missing or impossible rating, and a malformed key, without writing", async () => {
    for (const fields of [{ locale: "en", key: KEY }, { "visit-rating": "6", key: KEY }, { "visit-rating": "0", key: KEY }]) {
      const response = await post(fields);
      expect(response.status).toBe(303);
    }
    const badKey = await post({ "visit-rating": "3", key: "short" });
    expect(new URL(badKey.headers.get("location")!).searchParams.get("rating")).toBe("3");
    expect(calls).toEqual([]);
  });

  it("falls back to English for an unknown language", async () => {
    await post({ "visit-rating": "3", locale: "xx", key: KEY });
    expect(calls[1]!.input).toEqual({ locale: "en", idempotencyKey: `${KEY}.session` });
  });
});
