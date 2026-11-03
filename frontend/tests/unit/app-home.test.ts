import { describe, expect, it } from "vitest";

import { deriveHomeModel, type HomeCounts, type HomeStand } from "@/features/dashboard/home-model";
import { homeModelForApp } from "@/lib/owner/app-home";
import type { ServiceKind } from "@/lib/owner/service-state";

/**
 * App Store 3.1.3(f): the iPhone app is a free companion to a plan bought on
 * the website, so its Home may say the Tags are off or a payment failed, but
 * never offer a plan, a trial, a card update, or a way to Billing.
 */

const counts: HomeCounts = {
  ratingsToday: 0,
  unread: 0,
  activeStands: 1,
  recentCount: 0,
  hasGoogleLink: true,
};

const programmed: HomeStand = {
  standId: "stand-1",
  label: "Counter",
  status: "active",
  nfcProvisionedAt: "2026-10-01T00:00:00.000Z",
  tokenRotatedAt: null,
};

function forApp(service: ServiceKind, overrides: Partial<HomeCounts> = {}) {
  const input = { counts: { ...counts, ...overrides }, stands: [programmed], hasLocation: true, service, canManageBilling: true };
  return { web: deriveHomeModel(input), app: homeModelForApp(deriveHomeModel(input), service) };
}

const PAYING = /choose a plan|update your card|free for|billing|subscribe|trial/i;

describe("Home for the iPhone app", () => {
  it.each<ServiceKind>(["no-plan", "past-due", "cancelled", "suspended"])(
    "keeps the fact and drops every pointer at paying (%s)",
    (service) => {
      for (const extra of [{}, { recentCount: 4, unread: 2 }]) {
        const { web, app } = forApp(service, extra);
        // The website does point at Billing in these states…
        expect(JSON.stringify(web)).toMatch(/\/settings\/billing/);
        // …the app never does, in any words, buttons or steps.
        const text = JSON.stringify(app);
        expect(text).not.toMatch(/\/settings\/billing/);
        expect(text).not.toMatch(PAYING);
        // The owner is still told something is wrong.
        expect(app.attentions.some((attention) => attention.kind === "plan" || attention.kind === "payment")).toBe(true);
      }
    },
  );

  it("changes nothing for a business whose plan is running", () => {
    const { web, app } = forApp("serving", { recentCount: 4, unread: 2 });
    expect(app).toEqual(web);
  });

  it("still sends the owner to read new ratings while a payment has failed", () => {
    const { app } = forApp("past-due", { recentCount: 4, unread: 2 });
    expect(app.attentions.find((attention) => attention.kind === "payment")?.body).toBe("Your Tags are still working.");
    expect(app.attentions.some((attention) => attention.kind === "unread")).toBe(true);
  });
});
