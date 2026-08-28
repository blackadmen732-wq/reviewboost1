import type {
  Organization,
  Location,
} from "./types";

export const MOCK_USER = {
  email: "owner@coffeehouse.com",
  name: "Jordan Rivera",
};

export const MOCK_ORGANIZATIONS: Organization[] = [
  {
    orgId: "org-1",
    name: "The Daily Grind",
    timezone: "America/New_York",
    role: "owner",
  },
  {
    orgId: "org-2",
    name: "Sunrise Bakery",
    timezone: "America/Chicago",
    role: "admin",
  },
];

export const MOCK_LOCATIONS: Location[] = [
  {
    locationId: "loc-1",
    orgId: "org-1",
    name: "Downtown",
    googleReviewUrl: "https://g.page/example/review",
  },
  {
    locationId: "loc-2",
    orgId: "org-1",
    name: "Airport Terminal B",
    googleReviewUrl: "https://g.page/example2/review",
  },
  {
    locationId: "loc-3",
    orgId: "org-2",
    name: "Main Street",
    googleReviewUrl: null,
  },
];

