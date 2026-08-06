import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerApiError } from "@/lib/api/customer-api-error";
import { productionCustomerFlowApi } from "@/lib/api/production-customer-flow-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("production customer API client", () => {
  it("sends credentials and the stable idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ responseId: "response-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      productionCustomerFlowApi.submitResponse(
        "fixture-valid",
        { sessionId: "session-1", rating: 3, note: "Unicode: José" },
        { idempotencyKey: "response-key-123456789" },
      ),
    ).resolves.toEqual({ responseId: "response-1" });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request).toBeInstanceOf(Request);
    expect(request.credentials).toBe("include");
    expect(request.headers.get("Idempotency-Key")).toBe("response-key-123456789");
    await expect(request.clone().json()).resolves.toEqual({
      sessionId: "session-1",
      rating: 3,
      note: "Unicode: José",
    });
  });

  it("never treats an undocumented 202 as completion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));

    await expect(
      productionCustomerFlowApi.submitResponse(
        "fixture-valid",
        { sessionId: "session-1", rating: 5 },
        { idempotencyKey: "response-key-123456789" },
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
