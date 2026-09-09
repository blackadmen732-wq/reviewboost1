import { listLocations, requireOwner } from "@/lib/server/owner-data";

interface DesignerOwnerQuery {
  role?: string;
  locations?: string;
}

/**
 * Who is looking at the designer, and which locations they have.
 *
 * Production always goes through `requireOwner`. The fixture branch exists so
 * the designer can be opened — and tested — without a Supabase session, the
 * same way `/q/fixture-valid` opens the customer page.
 */
export async function loadDesignerOwner(query: DesignerOwnerQuery = {}) {
  if (process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES === "true") {
    const { fixtureOwnerContext } = await import("@/lib/api/dev/fixture-owner-context");
    return fixtureOwnerContext({
      ...(query.role ? { role: query.role } : {}),
      locations: query.locations === "many" ? "many" : "one",
    });
  }

  const { organization } = await requireOwner("/customer-page");
  const locations = await listLocations(organization.orgId);
  return { organization, locations };
}
