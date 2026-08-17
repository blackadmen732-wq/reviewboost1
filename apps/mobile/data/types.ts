export interface Organization {
  orgId: string;
  name: string;
  timezone: string;
  role: "owner" | "manager" | "staff";
}

export interface Location {
  locationId: string;
  orgId: string;
  name: string;
  googleReviewUrl: string | null;
}

export interface FeedbackItem {
  id: string;
  rating: number;
  note: string | null;
  submittedAt: string;
  isRead: boolean;
  isResolved: boolean;
  noteCount: number;
}

export interface LiveFeedEntry {
  id: string;
  type: "tap" | "feedback";
  rating: number | null;
  submittedAt: string;
  locationName: string;
}

export interface OwnerNote {
  id: string;
  feedbackId: string;
  body: string;
  createdAt: string;
  authorName: string;
}
