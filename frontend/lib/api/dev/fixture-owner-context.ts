/**
 * Owner context for local and e2e work, when the customer fixtures are on.
 *
 * Never imported from a production path except behind
 * `NEXT_PUBLIC_USE_CUSTOMER_FIXTURES`, and never from a client module — the
 * production-fixture check looks at `.next/static`.
 */

export interface FixtureOwnerOrganization {
  orgId: string;
  name: string;
  role: string;
}

export interface FixtureOwnerLocation {
  locationId: string;
  name: string;
  googleReviewUrl: string | null;
}

export function fixtureOwnerContext(options?: {
  role?: string;
  locations?: "one" | "many";
}): {
  organization: FixtureOwnerOrganization;
  locations: FixtureOwnerLocation[];
} {
  const downtown: FixtureOwnerLocation = {
    locationId: "loc-1",
    name: "Downtown",
    googleReviewUrl: null,
  };
  const westside: FixtureOwnerLocation = {
    locationId: "loc-2",
    name: "Westside",
    googleReviewUrl: null,
  };

  return {
    organization: {
      orgId: "org-local",
      name: "Mario’s Pizza",
      role: options?.role === "viewer" ? "viewer" : "owner",
    },
    locations: options?.locations === "many" ? [downtown, westside] : [downtown],
  };
}
