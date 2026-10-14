import "server-only";

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
 * Square is `in_setup` until its adapter lands (stage 2). The `fake` provider
 * is a test double for local development and preview environments; it is
 * never listed in production.
 */

export type Availability = "available" | "in_setup" | "planned";

export type Category = "pos" | "appointments" | "salon" | "fitness" | "lists";

export const CATEGORY_LABELS: Record<Category, string> = {
  pos: "Point of sale",
  lists: "Customer lists",
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
  /**
   * How an owner connects it. `oauth` apps are ongoing connections that sync
   * (Square). A `list` is read once when the owner picks it and keeps no
   * access afterwards (a Google Sheet); it never goes through the OAuth
   * routes or the sync pipeline.
   */
  connectKind: "oauth" | "list";
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
  connectKind: "oauth",
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
  connectKind: "oauth",
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
    connectKind: "oauth",
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
 * Google Sheets works only where its keys are set (docs: GOOGLE_SHEETS.md)
 * and a default country is set, because a sheet's numbers are usually typed
 * without one. Until then the card says "Coming soon" and offers no sign-in.
 */
export function googleSheetsConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID &&
      process.env.NEXT_PUBLIC_GOOGLE_API_KEY &&
      /^\d{6,20}$/.test(process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER ?? "") &&
      /^\d{1,3}$/.test(process.env.SMS_DEFAULT_COUNTRY_CALLING_CODE ?? ""),
  );
}

function googleSheets(): ProviderDefinition {
  return {
    id: "google_sheets",
    connectKind: "list",
    displayName: "Google Sheets",
    monogram: "GS",
    categories: ["lists"],
    summary: "Bring in customers from a Google Sheet you already keep.",
    dataRead: ["Only the one sheet you pick", "Names and phone numbers in it"],
    cannotDo: [
      "See any other file in your Google account",
      "Change your sheet",
      "Text anyone. Customers still need to agree first.",
    ],
    availability: googleSheetsConfigured() ? "available" : "in_setup",
    workflows: [],
  };
}

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

export function listProviders(): ProviderDefinition[] {
  return [...(fakeProviderEnabled() ? [FAKE] : []), SQUARE, googleSheets(), ...PLANNED];
}

export function getProvider(id: string): ProviderDefinition | null {
  return listProviders().find((provider) => provider.id === id) ?? null;
}

/** A provider an owner can actually connect in this environment. */
export function getConnectableProvider(id: string): (ProviderDefinition & { id: ProviderId }) | null {
  const provider = getProvider(id);
  if (!provider || provider.availability !== "available" || provider.connectKind !== "oauth") return null;
  return provider as ProviderDefinition & { id: ProviderId };
}

export function getWorkflow(provider: ProviderDefinition, workflowId: string): WorkflowDefinition | null {
  return provider.workflows.find((workflow) => workflow.id === workflowId) ?? null;
}
