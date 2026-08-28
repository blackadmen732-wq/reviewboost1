export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export function parseMemberRole(value: unknown): MemberRole {
  if (typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value)) {
    return value as MemberRole;
  }
  throw new RangeError(`Unknown organization role: ${String(value)}`);
}

export interface Organization {
  orgId: string;
  name: string;
  timezone: string;
  role: MemberRole;
}

export interface Location {
  locationId: string;
  orgId: string;
  name: string;
  googleReviewUrl: string | null;
}

export interface FeedbackItem {
  id: string;
  orgId: string;
  locationId: string;
  rating: number;
  note: string | null;
  submittedAt: string;
  isRead: boolean;
  isResolved: boolean;
}

export interface LiveFeedEntry {
  id: string;
  orgId: string;
  locationId: string;
  type: "tap" | "feedback";
  rating: number | null;
  submittedAt: string;
  // The backend join may return null for locations the caller can see the
  // event for but not the row for; the UI substitutes a fallback label.
  locationName: string | null;
}

export interface OwnerNote {
  id: string;
  feedbackId: string;
  body: string;
  createdAt: string;
  authorName: string;
}
