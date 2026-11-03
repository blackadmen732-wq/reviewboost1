import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerFlow } from "@/features/customer-flow/customer-flow";
import { navigateToDestination } from "@/features/customer-flow/destination-handoff";
import { CustomerApiError } from "@/lib/api/customer-api-error";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { renderWithProviders } from "@/tests/helpers/render";

/**
 * The customer page starts its session as it opens (so the star only saves
 * the rating, and an open counts as a tap). These are the ways that can go
 * wrong that starting it at the star never had: a session that has expired by
 * the time the star is tapped, an opening request that stalls, and a retry
 * page counting one customer twice.
 */

type CreateSession = (n: number) => Promise<{ sessionId: string }>;
type SubmitResponse = (body: Record<string, unknown>) => Promise<{ responseId: string }>;

const h = vi.hoisted(() => ({
  calls: [] as Array<{ op: "session" | "response"; key: string; body: Record<string, unknown> }>,
  createSession: null as unknown as CreateSession,
  submitResponse: null as unknown as SubmitResponse,
}));

vi.mock("@/features/customer-flow/destination-handoff", () => ({ navigateToDestination: vi.fn() }));

vi.mock("@/lib/api/customer-flow-api", () => {
  const api = {
    async getContext() {
      throw new Error("the context comes from the server render");
    },
    createSession(_token: string, body: Record<string, unknown>, options: { idempotencyKey: string }) {
      h.calls.push({ op: "session", key: options.idempotencyKey, body });
      return h.createSession(h.calls.filter((call) => call.op === "session").length);
    },
    submitResponse(_token: string, body: Record<string, unknown>, options: { idempotencyKey: string }) {
      h.calls.push({ op: "response", key: options.idempotencyKey, body });
      return h.submitResponse(body);
    },
    async recordDestinationSelection() {
      return undefined;
    },
  };
  return { getCustomerFlowApi: async () => api };
});

const DESTINATION = "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";
const CONTEXT = {
  business: { name: "Mario’s Pizza", logoUrl: null },
  location: { name: "Downtown" },
  page: null,
  destination: { provider: "google" as const, url: DESTINATION },
  googleReviewUrl: DESTINATION,
  supportedLocales: ["en", "es", "ht"] as Array<"en" | "es" | "ht">,
  defaultLocale: "en" as const,
};

const calls = (op: "session" | "response") => h.calls.filter((call) => call.op === op);

beforeEach(() => {
  h.calls.length = 0;
  vi.mocked(navigateToDestination).mockClear();
  window.sessionStorage.clear();
  h.createSession = (n) => Promise.resolve({ sessionId: `S-${n}` });
  h.submitResponse = () => Promise.resolve({ responseId: "R-1" });
});

describe("a session started as the page opens", () => {
  it("is replaced once, quietly, when it has expired by the time the star is tapped", async () => {
    // A tab left open for a day, or restored from its saved draft.
    h.submitResponse = (body) =>
      body.sessionId === "S-1"
        ? Promise.reject(new CustomerApiError({ status: 410, code: "session_expired", message: "expired" }))
        : Promise.resolve({ responseId: "R-2" });
    const user = userEvent.setup();
    renderWithProviders(<CustomerFlow token="fixture-valid" initialContext={CONTEXT} />);
    await waitFor(() => expect(calls("session")).toHaveLength(1));

    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[4] }));
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });

    expect(calls("response").map((call) => call.body.sessionId)).toEqual(["S-1", "S-2"]);
    // A new session gets new keys: reusing the old ones would be a conflict.
    expect(new Set(calls("session").map((call) => call.key)).size).toBe(2);
    expect(new Set(calls("response").map((call) => call.key)).size).toBe(2);
    await waitFor(() => expect(navigateToDestination).toHaveBeenCalledWith(DESTINATION));
  });

  it("does not hold the star when the opening request stalls", async () => {
    // A phone switching from cellular to the shop's Wi-Fi mid-request.
    h.createSession = (n) => (n === 1 ? new Promise(() => {}) : Promise.resolve({ sessionId: "S-2" }));
    const user = userEvent.setup();
    renderWithProviders(<CustomerFlow token="fixture-valid" initialContext={CONTEXT} />);
    await waitFor(() => expect(calls("session")).toHaveLength(1));

    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[5] }));
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading }, { timeout: 8_000 });

    // The star starts the session itself with the same key, so a request that
    // did reach the server is replayed, never made twice.
    const keys = calls("session").map((call) => call.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(calls("response")).toHaveLength(1);
  }, 12_000);

  it("is not started on the retry page after an early submit failed, so one customer is one tap", async () => {
    // That early form already made a session on the server.
    const user = userEvent.setup();
    renderWithProviders(
      <CustomerFlow
        token="fixture-valid"
        initialContext={CONTEXT}
        earlyForm={{ action: "/q/fixture-valid/rate", key: "0123456789abcdef0123456789abcdef" }}
        failedRating={4}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls("session")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: customerMessages.en.tryAgain }));
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });
    expect(calls("session")).toHaveLength(1);
    expect(calls("response")).toHaveLength(1);
  });
});
