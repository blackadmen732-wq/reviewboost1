import { describe, expect, it } from "vitest";

import { deriveConnections, PLANNED_SERVICES, type ConnectionsInput } from "@/lib/owner/connections";
import {
  compareCustomers,
  customerConsentState,
  matchesCustomer,
  textRequestStatus,
} from "@/lib/owner/customers";

describe("customer consent, in owner words", () => {
  it("reads the ledger, and treats anything but a yes as no agreement", () => {
    expect(customerConsentState("opted_in").kind).toBe("agreed");
    expect(customerConsentState("opted_out").kind).toBe("opted_out");
    expect(customerConsentState("unknown").kind).toBe("no_record");
    expect(customerConsentState(null).kind).toBe("no_record");
    expect(customerConsentState("something_new").kind).toBe("no_record");
  });

  it("calls a carrier acceptance Sent, and only a receipt Delivered", () => {
    expect(textRequestStatus("submitted").label).toBe("Sent");
    expect(textRequestStatus("delivered").label).toBe("Delivered");
    expect(textRequestStatus("provider_unknown").label).toBe("Delivery unknown");
  });
});

describe("finding a customer", () => {
  const ana = { name: "Ána López", lastFour: "0142" };
  const unnamed = { name: null, lastFour: "7781" };

  it("matches a name without case or accents, or the last digits", () => {
    expect(matchesCustomer(ana, "ana")).toBe(true);
    expect(matchesCustomer(ana, "LOPEZ")).toBe(true);
    expect(matchesCustomer(ana, "142")).toBe(true);
    expect(matchesCustomer(ana, "9999")).toBe(false);
    expect(matchesCustomer(unnamed, "81")).toBe(true);
    expect(matchesCustomer(unnamed, "bob")).toBe(false);
    expect(matchesCustomer(unnamed, "")).toBe(true);
  });

  it("lists named customers by name, then the unnamed by number", () => {
    const sorted = [unnamed, { name: "zoe", lastFour: "1" }, ana].sort(compareCustomers);
    expect(sorted.map((c) => c.name ?? c.lastFour)).toEqual(["Ána López", "zoe", "7781"]);
  });
});

describe("Connections, from real state only", () => {
  const base: ConnectionsInput = {
    places: [{ name: "Main St", link: "set" }],
    billing: { planName: "Starter", status: "active", renewsOn: "2026-11-01T00:00:00Z", trialEndsOn: null, cancelAtPeriodEnd: false },
    texting: "live",
    signInMethods: ["email", "google"],
  };
  const card = (input: ConnectionsInput, id: string) => deriveConnections(input).find((c) => c.id === id)!;

  it("has no switches: every action is a link to the screen that changes it", () => {
    for (const c of deriveConnections(base)) {
      if (c.action) expect(c.action.href).toMatch(/^\/(settings|text-requests)/);
    }
  });

  it("marks the Google link set, missing, or needing attention per place", () => {
    expect(card(base, "google").state).toBe("connected");
    expect(card({ ...base, places: [{ name: "Main St", link: "missing" }] }, "google").state).toBe("not_connected");
    expect(card({ ...base, places: [] }, "google").state).toBe("not_connected");
    expect(
      card({ ...base, places: [{ name: "A", link: "set" }, { name: "B", link: "missing" }] }, "google").state,
    ).toBe("attention");
    expect(card({ ...base, places: [{ name: "A", link: "invalid" }] }, "google").state).toBe("attention");
    expect(card({ ...base, places: [{ name: "A", link: "needs_upgrade" }] }, "google").state).toBe("attention");
  });

  it("never invents a plan", () => {
    expect(card({ ...base, billing: null }, "billing")).toMatchObject({ state: "attention", stateLabel: "Couldn't check" });
    expect(
      card({ ...base, billing: { planName: null, status: null, renewsOn: null, trialEndsOn: null, cancelAtPeriodEnd: false } }, "billing")
        .stateLabel,
    ).toBe("No plan yet");
    expect(card({ ...base, billing: { ...base.billing!, status: "past_due" } }, "billing").stateLabel).toBe("Payment needed");
    expect(card(base, "billing").facts).toEqual([
      { label: "Plan", value: "Starter" },
      { label: "Renews", value: "Nov 1, 2026" },
    ]);
  });

  it("says test mode plainly, and offers nothing when texting isn't set up", () => {
    expect(card({ ...base, texting: "test" }, "texting").stateLabel).toBe("Test mode");
    const off = card({ ...base, texting: "not_set_up" }, "texting");
    expect(off.state).toBe("not_available");
    expect(off.action).toBeNull();
  });

  it("names sign-in methods, and separates Google sign-in from a Business Profile", () => {
    const signIn = card(base, "sign_in");
    expect(signIn.facts[0]!.value).toBe("Email code · Google");
    expect(signIn.purpose).toMatch(/doesn't connect your Google Business Profile/);
  });

  it("lists services that cannot be connected without any action", () => {
    expect(PLANNED_SERVICES.length).toBeGreaterThan(0);
    for (const service of PLANNED_SERVICES) expect(Object.keys(service).sort()).toEqual(["kind", "name"]);
  });
});
