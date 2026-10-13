/**
 * Settings → Connections: what this business is connected to, from real state.
 *
 * Every card here is derived from something the backend actually holds — the
 * places' Google links, the Stripe-backed plan, whether texting is set up on
 * this deployment, and how the owner signs in. Nothing is a switch. A service
 * ReviewBoost cannot connect to yet is listed as not available, with no
 * button, because a Connect control that does nothing is worse than none.
 */

export type ConnectionState = "connected" | "attention" | "not_connected" | "test_mode" | "not_available";

export interface ConnectionFact {
  label: string;
  value: string;
}

export interface ConnectionCard {
  id: "google" | "billing" | "texting" | "sign_in";
  name: string;
  purpose: string;
  state: ConnectionState;
  stateLabel: string;
  facts: ConnectionFact[];
  action: { label: string; href: string } | null;
}

export interface PlannedService {
  name: string;
  kind: string;
}

export interface ConnectionsInput {
  /** Each place, with whether its Google link works, is missing, or is wrong. */
  places: ReadonlyArray<{
    name: string;
    link: "set" | "needs_upgrade" | "invalid" | "missing";
  }>;
  /** Null when the plan could not be read: shown as unknown, never as a default. */
  billing: {
    planName: string | null;
    status: "trialing" | "active" | "past_due" | "cancelled" | "suspended" | null;
    renewsOn: string | null;
    trialEndsOn: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  texting: "live" | "test" | "not_set_up";
  signInMethods: readonly string[];
}

const SIGN_IN_NAMES: Record<string, string> = {
  email: "Email code",
  apple: "Apple",
  google: "Google",
};

function googleCard(places: ConnectionsInput["places"]): ConnectionCard {
  const facts = places.map((place) => ({
    label: place.name,
    value:
      place.link === "set"
        ? "Link works"
        : place.link === "needs_upgrade"
          ? "Works, but opens your listing, not the review box"
          : place.link === "invalid"
            ? "Link isn't a Google review link"
            : "No link yet",
  }));
  const allMissing = places.every((place) => place.link === "missing");
  const allSet = places.length > 0 && places.every((place) => place.link === "set");
  const state: ConnectionState = allMissing ? "not_connected" : allSet ? "connected" : "attention";

  return {
    id: "google",
    name: "Google review link",
    purpose: "Where every rating sends your customer. This is a link, not access to your Google account.",
    state,
    stateLabel:
      state === "connected" ? "Set up" : state === "not_connected" ? "Not set up" : "Needs attention",
    facts,
    action: {
      label: state === "not_connected" ? "Add your link" : state === "attention" ? "Fix link" : "Change link",
      href: "/settings",
    },
  };
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function billingCard(billing: ConnectionsInput["billing"]): ConnectionCard {
  const base = {
    id: "billing" as const,
    name: "Billing",
    purpose: "Your plan and payments, handled by Stripe.",
    action: { label: "Manage billing", href: "/settings/billing" },
  };
  if (billing === null) {
    return { ...base, state: "attention", stateLabel: "Couldn't check", facts: [{ label: "Plan", value: "Couldn't be read just now" }] };
  }
  const facts: ConnectionFact[] = [];
  if (billing.planName) facts.push({ label: "Plan", value: billing.planName });
  if (billing.status === "trialing" && billing.trialEndsOn) {
    facts.push({ label: "Trial ends", value: formatDay(billing.trialEndsOn) });
  } else if (billing.renewsOn && (billing.status === "active" || billing.status === "past_due")) {
    facts.push({ label: billing.cancelAtPeriodEnd ? "Ends" : "Renews", value: formatDay(billing.renewsOn) });
  }

  switch (billing.status) {
    case "active":
      return { ...base, state: "connected", stateLabel: "Active", facts };
    case "trialing":
      return { ...base, state: "connected", stateLabel: "Free trial", facts };
    case "past_due":
      return { ...base, state: "attention", stateLabel: "Payment needed", facts };
    case "cancelled":
      return { ...base, state: "not_connected", stateLabel: "Cancelled", facts };
    case "suspended":
      return { ...base, state: "attention", stateLabel: "Paused", facts };
    default:
      return { ...base, state: "not_connected", stateLabel: "No plan yet", facts, action: { label: "Choose a plan", href: "/settings/billing" } };
  }
}

function textingCard(texting: ConnectionsInput["texting"]): ConnectionCard {
  const base = {
    id: "texting" as const,
    name: "Text messages",
    purpose: "Sends your Text Requests. ReviewBoost runs this for you; there is nothing to sign in to.",
  };
  if (texting === "live") {
    return {
      ...base,
      state: "connected",
      stateLabel: "Ready",
      facts: [{ label: "Delivery", value: "Texts go to customers' phones" }],
      action: { label: "Open Text Requests", href: "/text-requests" },
    };
  }
  if (texting === "test") {
    return {
      ...base,
      state: "test_mode",
      stateLabel: "Test mode",
      facts: [{ label: "Delivery", value: "Texts are recorded here but not sent to phones" }],
      action: { label: "Open Text Requests", href: "/text-requests" },
    };
  }
  return {
    ...base,
    state: "not_available",
    stateLabel: "Not available yet",
    facts: [{ label: "Delivery", value: "ReviewBoost is finishing text message setup" }],
    action: null,
  };
}

function signInCard(methods: readonly string[]): ConnectionCard {
  const names = [...new Set(methods)].map((method) => SIGN_IN_NAMES[method] ?? method);
  return {
    id: "sign_in",
    name: "Your sign-in",
    purpose: "How you get into ReviewBoost. Signing in with Google doesn't connect your Google Business Profile.",
    state: "connected",
    stateLabel: "Signed in",
    facts: [{ label: "Using", value: names.length > 0 ? names.join(" · ") : "Email code" }],
    action: null,
  };
}

export function deriveConnections(input: ConnectionsInput): ConnectionCard[] {
  return [googleCard(input.places), billingCard(input.billing), textingCard(input.texting), signInCard(input.signInMethods)];
}

/**
 * Point-of-sale and booking systems a connection could bring visits in from.
 * Not built: listed so an owner knows where it stands, with no button.
 */
export const PLANNED_SERVICES: readonly PlannedService[] = [
  { name: "Square", kind: "Point of sale" },
  { name: "Toast", kind: "Point of sale" },
  { name: "Clover", kind: "Point of sale" },
];
