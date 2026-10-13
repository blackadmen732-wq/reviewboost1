import "server-only";

import { squareConfig } from "@/lib/server/integrations/providers/square/config";
import type { ProviderId, VisitKind, WorkflowId } from "@/lib/server/integrations/types";

/**
 * Every provider the directory knows about (docs/connections/02 and 04).
 *
 * This is code, not data: adding a provider, or making one connectable, is a
 * reviewed diff. `availability` decides what an owner can do with a card:
 *
 *   available   — has an adapter, is configured here: Connect works.
 *   in_setup    — being built, or not configured in this environment: "Coming soon".
 *   planned     — on the list, nothing built: "Planned".
 *
 * Square is `available` only where its application is configured, and
 * `in_setup` ("Coming soon") everywhere else. Configured against Square's
 * sandbox, it says so on the card: a sandbox account holds test data, never a
 * real business's customers. The `fake` provider
 * is a test double for local development and preview environments; it is
 * never listed in production.
 */

export type Availability = "available" | "in_setup" | "planned";

export type Category = "pos" | "appointments" | "salon" | "fitness";

export const CATEGORY_LABELS: Record<Category, string> = {
  pos: "Point of sale",
  appointments: "Appointments",
  salon: "Salons and spas",
  fitness: "Fitness",
};

export interface WorkflowDefinition {
  id: WorkflowId;
  label: string;
  /** The stream a sync of this workflow reads; also the visit kind it produces. */
  stream: "payments" | "bookings";
  visitKind: VisitKind;
  scopes: readonly string[];
  /** Owner words for each permission: what it reads and why. */
  permissions: readonly { label: string; reason: string }[];
}

export interface ProviderDefinition {
  id: string;
  displayName: string;
  /** Short mark for the card when there is no logo asset. */
  monogram: string;
  categories: readonly Category[];
  summary: string;
  dataRead: readonly string[];
  cannotDo: readonly string[];
  availability: Availability;
  workflows: readonly WorkflowDefinition[];
}

const SQUARE: ProviderDefinition = {
  id: "square",
  displayName: "Square",
  monogram: "Sq",
  categories: ["pos", "appointments"],
  summary: "Find customers from your Square sales or appointments.",
  dataRead: [
    "Your locations",
    "Names and phone numbers of customers who visited",
    "When they paid or had an appointment",
  ],
  cannotDo: [
    "Change anything in Square",
    "See card numbers or what people bought",
    "Text anyone. Customers still need to agree first.",
  ],
  availability: "in_setup",
  workflows: [
    {
      id: "payments",
      label: "Sales (Square Point of Sale)",
      stream: "payments",
      visitKind: "payment",
      scopes: ["MERCHANT_PROFILE_READ", "CUSTOMERS_READ", "PAYMENTS_READ"],
      permissions: [
        { label: "Your locations", reason: "To match Square places to yours" },
        { label: "Customers who visited", reason: "To find their name and number" },
        { label: "When they paid", reason: "To know who visited and when" },
      ],
    },
    {
      id: "appointments",
      label: "Appointments (Square Appointments)",
      stream: "bookings",
      visitKind: "appointment",
      scopes: ["MERCHANT_PROFILE_READ", "CUSTOMERS_READ", "APPOINTMENTS_READ", "APPOINTMENTS_ALL_READ"],
      permissions: [
        { label: "Your locations", reason: "To match Square places to yours" },
        { label: "Customers who booked", reason: "To find their name and number" },
        { label: "When their appointment was", reason: "To know who visited and when" },
      ],
    },
  ],
};

const FAKE: ProviderDefinition = {
  id: "fake",
  displayName: "Test provider",
  monogram: "T",
  categories: ["pos", "appointments"],
  summary: "A pretend point of sale for trying Connections. No real customers.",
  dataRead: ["Pretend locations", "Pretend customers and visits"],
  cannotDo: ["Reach any real system", "Text anyone"],
  availability: "available",
  workflows: [
    {
      id: "payments",
      label: "Sales",
      stream: "payments",
      visitKind: "payment",
      scopes: ["locations.read", "customers.read", "payments.read"],
      permissions: [
        { label: "Your locations", reason: "To match its places to yours" },
        { label: "Customers who visited", reason: "To find their name and number" },
        { label: "When they paid", reason: "To know who visited and when" },
      ],
    },
    {
      id: "appointments",
      label: "Appointments",
      stream: "bookings",
      visitKind: "appointment",
      scopes: ["locations.read", "customers.read", "bookings.read"],
      permissions: [
        { label: "Your locations", reason: "To match its places to yours" },
        { label: "Customers who booked", reason: "To find their name and number" },
        { label: "When their appointment was", reason: "To know who visited and when" },
      ],
    },
  ],
};

function planned(id: string, displayName: string, monogram: string, categories: Category[], summary: string): ProviderDefinition {
  return {
    id,
    displayName,
    monogram,
    categories,
    summary,
    dataRead: [],
    cannotDo: [],
    availability: "planned",
    workflows: [],
  };
}

const PLANNED: readonly ProviderDefinition[] = [
  planned("vagaro", "Vagaro", "V", ["appointments", "salon"], "Bookings for salons and spas."),
  planned("toast", "Toast", "To", ["pos"], "Point of sale for restaurants."),
  planned("clover", "Clover", "Cl", ["pos"], "Point of sale for restaurants and shops."),
  planned("mindbody", "Mindbody", "M", ["appointments", "fitness"], "Classes and appointments for studios."),
];

/**
 * The fake provider shows up only where someone switched it on, and never in
 * production. Production on Vercel is `VERCEL_ENV=production`; elsewhere a
 * plain production build counts too unless it is a Vercel preview.
 */
export function fakeProviderEnabled(): boolean {
  if (process.env.INTEGRATIONS_FAKE_PROVIDER !== "enabled") return false;
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv !== "production";
  return process.env.NODE_ENV !== "production";
}

/** Square as this environment can offer it. */
function square(): ProviderDefinition {
  const config = squareConfig();
  if (!config) return SQUARE;
  if (config.environment === "production") return { ...SQUARE, availability: "available" };
  return {
    ...SQUARE,
    availability: "available",
    summary: "Test mode: connects a Square sandbox account, not a real business.",
  };
}

export function listProviders(): ProviderDefinition[] {
  return [...(fakeProviderEnabled() ? [FAKE] : []), square(), ...PLANNED];
}

export function getProvider(id: string): ProviderDefinition | null {
  return listProviders().find((provider) => provider.id === id) ?? null;
}

/** A provider an owner can actually connect in this environment. */
export function getConnectableProvider(id: string): (ProviderDefinition & { id: ProviderId }) | null {
  const provider = getProvider(id);
  if (!provider || provider.availability !== "available") return null;
  return provider as ProviderDefinition & { id: ProviderId };
}

export function getWorkflow(provider: ProviderDefinition, workflowId: string): WorkflowDefinition | null {
  return provider.workflows.find((workflow) => workflow.id === workflowId) ?? null;
}
