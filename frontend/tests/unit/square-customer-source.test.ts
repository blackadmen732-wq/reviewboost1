import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SQUARE_CONTACTS_SCOPE,
  SQUARE_CUSTOMERS_API_VERSION,
  SquareContactError,
  readSquareContactPage,
} from "@/lib/server/integrations/providers/square/customer-source";

const token = "test-oauth-token";

function stub(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("Square contact-source: read-only and consent-neutral", () => {
  it("requests only a Square customer's public contact profile via sandbox GET", async () => {
    const fetchImpl = stub(200, {
      customers: [{
        id: "sq-customer-1",
        given_name: "Sarah",
        family_name: "M.",
        phone_number: "+1 (305) 555-0101",
        email_address: "not-needed@example.test",
        note: "private note not requested",
        created_at: "2026-10-17T12:00:00Z",
        version: 3,
      }],
      cursor: "cursor-next",
    });
    const page = await readSquareContactPage({
      accessToken: token, environment: "sandbox", limit: 15, fetchImpl,
    });
    expect(SQUARE_CONTACTS_SCOPE).toBe("CUSTOMERS_READ");
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://connect.squareupsandbox.com/v2/customers?limit=15");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_CUSTOMERS_API_VERSION,
    });
    expect(page).toEqual({
      customers: [{
        externalId: "sq-customer-1",
        name: "Sarah M.",
        phone: "+1 (305) 555-0101",
        sourceCreatedAt: new Date("2026-10-17T12:00:00Z"),
        sourceUpdatedAt: null,
        sourceVersion: 3,
      }],
      nextCursor: "cursor-next",
    });
    expect(page.customers[0]).not.toHaveProperty("email_address");
    expect(page.customers[0]).not.toHaveProperty("note");
    expect(page.customers[0]).not.toHaveProperty("smsConsent");
  });

  it("supports cursor pagination and the production Square host without altering Square", async () => {
    const fetchImpl = stub(200, { customers: [], cursor: "next" });
    const page = await readSquareContactPage({
      accessToken: token, environment: "production", cursor: "a+b/c==", fetchImpl,
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://connect.squareup.com/v2/customers?");
    expect(new URL(url).searchParams.get("cursor")).toBe("a+b/c==");
    expect(init.method).toBe("GET");
    expect(page).toEqual({ customers: [], nextCursor: "next" });
  });

  it.each([401, 403])("requires reauthorization on HTTP %i", async (status) => {
    await expect(
      readSquareContactPage({ accessToken: token, environment: "sandbox", fetchImpl: stub(status, {}) }),
    ).rejects.toMatchObject({ reason: "authorization_required" });
  });

  it("distinguishes rate limits, server outages, and malformed results", async () => {
    for (const [status, body, reason] of [
      [429, {}, "rate_limited"],
      [503, {}, "temporary_unavailable"],
      [200, { customers: [{ phone_number: "+1 305 555 0101" }] }, "invalid_response"],
    ] as const) {
      await expect(
        readSquareContactPage({ accessToken: token, environment: "sandbox", fetchImpl: stub(status, body) }),
      ).rejects.toMatchObject({ reason });
    }
  });

  it("rejects empty tokens and invalid page sizes before a request", async () => {
    const fetchImpl = stub(200, {});
    await expect(readSquareContactPage({
      accessToken: " ", environment: "sandbox", fetchImpl,
    })).rejects.toBeInstanceOf(SquareContactError);
    await expect(readSquareContactPage({
      accessToken: token, environment: "sandbox", limit: 101, fetchImpl,
    })).rejects.toBeInstanceOf(RangeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
