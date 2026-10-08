import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerApiError } from "@/lib/api/customer-api-error";
import { productionCustomerFlowApi } from "@/lib/api/production-customer-flow-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("production customer API client", () => {
  it("sends the tap as one keepalive request, without credentials, under its idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const sent = productionCustomerFlowApi.submitRating(
      "fixture-valid",
      { rating: 3, locale: "es" },
      { idempotencyKey: "rb_rating_key-123456789" },
    );
    // Started before submitRating returns: the page navigates in the same
    // tick, and a request not yet begun would never be.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(sent).resolves.toBeUndefined();

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request).toBeInstanceOf(Request);
    expect(new URL(request.url).pathname).toBe("/api/v1/public/q/fixture-valid/ratings");
    expect(request.method).toBe("POST");
    // Without keepalive the browser cancels it when the review page takes
    // over, and the rating is quietly lost — with no error anywhere, because
    // the tab is already gone.
    expect(request.keepalive).toBe(true);
    expect(request.credentials).toBe("omit");
    expect(request.headers.get("Idempotency-Key")).toBe("rb_rating_key-123456789");
    await expect(request.clone().json()).resolves.toEqual({ rating: 3, locale: "es" });
  });

  it("never treats an undocumented 202 as completion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));

    await expect(
      productionCustomerFlowApi.submitRating(
        "fixture-valid",
        { rating: 5, locale: "en" },
        { idempotencyKey: "rb_rating_key-123456789" },
      ),
    ).rejects.toMatchObject({
      status: 202,
      code: "operation_not_terminal",
    } satisfies Partial<CustomerApiError>);
  });

  it("keeps backend error codes separate in a typed API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "review_link_inactive", message: "Internal wording" },
            requestId: "request-1",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(productionCustomerFlowApi.getContext("fixture-inactive")).rejects.toMatchObject({
      status: 404,
      code: "review_link_inactive",
      requestId: "request-1",
    } satisfies Partial<CustomerApiError>);
  });
});
