import type {
  Organization,
  Location,
  FeedbackItem,
  LiveFeedEntry,
  OwnerNote,
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

export const MOCK_FEEDBACK: FeedbackItem[] = [
  {
    id: "fb-1",
    orgId: "org-1",
    locationId: "loc-1",
    rating: 2,
    note: "Coffee was cold and the barista seemed rushed. I've been coming here for two years and this is the first time I've been disappointed.",
    submittedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    isRead: false,
    isResolved: false,
    noteCount: 0,
  },
  {
    id: "fb-2",
    orgId: "org-1",
    locationId: "loc-2",
    rating: 5,
    note: "Absolutely love this place! Best latte in town.",
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    isRead: true,
    isResolved: false,
    noteCount: 1,
  },
  {
    id: "fb-3",
    orgId: "org-1",
    locationId: "loc-1",
    rating: 3,
    note: "Food was fine. Service could be faster during lunch rush.",
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    isRead: true,
    isResolved: true,
    noteCount: 2,
  },
  {
    id: "fb-4",
    orgId: "org-1",
    locationId: "loc-1",
    rating: 1,
    note: "Found a hair in my food. Will not be returning.",
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    isRead: false,
    isResolved: false,
    noteCount: 0,
  },
  {
    id: "fb-5",
    orgId: "org-1",
    locationId: "loc-2",
    rating: 4,
    note: null,
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    isRead: true,
    isResolved: true,
    noteCount: 0,
  },
  {
    id: "fb-6",
    orgId: "org-2",
    locationId: "loc-3",
    rating: 5,
    note: "The new seasonal menu is incredible. Keep it up!",
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    isRead: true,
    isResolved: false,
    noteCount: 0,
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

export const MOCK_NOTES: Record<string, OwnerNote[]> = {
  "fb-2": [
    {
      id: "note-1",
      feedbackId: "fb-2",
      body: "Thanked customer in person today — they're a regular.",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      authorName: "Jordan Rivera",
    },
  ],
  "fb-3": [
    {
      id: "note-2",
      feedbackId: "fb-3",
      body: "Spoke with kitchen team about lunch pacing.",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      authorName: "Jordan Rivera",
    },
    {
      id: "note-3",
      feedbackId: "fb-3",
      body: "Added a second prep station for the 11:30–1:00 window.",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      authorName: "Jordan Rivera",
    },
  ],
};
