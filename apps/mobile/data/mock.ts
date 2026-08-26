import type {
  Organization,
  Location,
  LiveFeedEntry,
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
    role: "manager",
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

export const MOCK_LIVE_FEED: LiveFeedEntry[] = [
  {
    id: "lf-1",
    orgId: "org-1",
    locationId: "loc-1",
    type: "feedback",
    rating: 2,
    submittedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    locationName: "Downtown",
  },
  {
    id: "lf-2",
    orgId: "org-1",
    locationId: "loc-1",
    type: "tap",
    rating: null,
    submittedAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    locationName: "Downtown",
  },
  {
    id: "lf-3",
    orgId: "org-1",
    locationId: "loc-2",
    type: "feedback",
    rating: 5,
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    locationName: "Airport Terminal B",
  },
  {
    id: "lf-4",
    orgId: "org-1",
    locationId: "loc-1",
    type: "tap",
    rating: null,
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    locationName: "Downtown",
  },
  {
    id: "lf-5",
    orgId: "org-1",
    locationId: "loc-1",
    type: "feedback",
    rating: 3,
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    locationName: "Downtown",
  },
  {
    id: "lf-6",
    orgId: "org-2",
    locationId: "loc-3",
    type: "tap",
    rating: null,
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 10).toISOString(),
    locationName: "Main Street",
  },
];

