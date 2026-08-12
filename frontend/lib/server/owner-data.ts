import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { tryDecrypt } from "@/lib/server/crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { startOfLocalDay, startOfLocalMonth } from "@/lib/utils/local-day";

export { localHour, startOfLocalDay, startOfLocalMonth } from "@/lib/utils/local-day";

/**
 * Every read the owner interface performs, in one place.
 *
 * ON ISOLATION
 * ------------
 * Every query carries an explicit `eq("org_id", orgId)` in addition to RLS.
 * RLS prevents cross-tenant reads, but a user who belongs to two organizations
 * would see combined results without the explicit filter. The org_id filter
 * ensures clean per-organization views; RLS is defense in depth.
 */

const ORG_COOKIE = "rb-active-org";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CurrentOrganization {
  orgId: string;
  membershipId: string;
  name: string;
  timezone: string;
  role: string;
}

export interface OwnerContext {
  user: User;
  organization: CurrentOrganization;
  organizations: CurrentOrganization[];
}

type OrgFields = { name: string; timezone: string };
type MembershipRow = {
  id: string;
  org_id: string;
  role: string;
  organizations: OrgFields | OrgFields[] | null;
};

/**
 * All active memberships for the signed-in user.
 */
export const listUserOrganizations = cache(async (): Promise<CurrentOrganization[]> => {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("organization_members")
    .select("id, org_id, role, organizations(name, timezone)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => {
    const r = row as MembershipRow;
    const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
    return {
      orgId: r.org_id,
      membershipId: r.id,
      name: org?.name ?? "Your business",
      timezone: org?.timezone ?? "UTC",
      role: r.role,
    };
  });
});

/**
 * Resolve the active organization from cookie, validated against memberships.
 *
 * If the user has one membership, that one is used regardless of cookie.
 * If the user has multiple, the cookie must match a valid membership.
 * Returns null if no memberships exist or if multi-org with no valid selection.
 */
export const getActiveOrganization = cache(
  async (): Promise<{
    active: CurrentOrganization | null;
    all: CurrentOrganization[];
    needsSelection: boolean;
  }> => {
    const organizations = await listUserOrganizations();

    if (organizations.length === 0) {
      return { active: null, all: [], needsSelection: false };
    }

    if (organizations.length === 1) {
      return { active: organizations[0] ?? null, all: organizations, needsSelection: false };
    }

    const store = await cookies();
    const cookieOrgId = store.get(ORG_COOKIE)?.value;

    if (cookieOrgId && UUID_RE.test(cookieOrgId)) {
      const match = organizations.find((o) => o.orgId === cookieOrgId);
      if (match) {
        return { active: match, all: organizations, needsSelection: false };
      }
    }

    return { active: null, all: organizations, needsSelection: true };
  },
);

/**
 * The gate every owner page opens with.
 *
 * Validates the active organization against the user's memberships.
 * If the user belongs to multiple organizations and none is selected,
 * redirects to the organization picker.
 */
export const requireOwner = cache(async (nextPath: string): Promise<OwnerContext> => {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  const { active, all, needsSelection } = await getActiveOrganization();

  if (all.length === 0) redirect("/onboarding");

  if (needsSelection) {
    redirect(`/select-org?next=${encodeURIComponent(nextPath)}`);
  }

  return { user, organization: active!, organizations: all };
});

export interface Page<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

const MAX_PAGE = 50;

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 25, 1), MAX_PAGE);
}

/**
 * Fetch one row more than asked for.
 *
 * The cheapest possible "is there a next page": no second count query, which on
 * a growing table is the expensive one.
 */
function paginate<T, R extends { submitted_at?: string; created_at?: string }>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
  cursorField: "submitted_at" | "created_at",
): Page<T> {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible[visible.length - 1];

  return {
    items: visible.map(map),
    hasMore,
    nextCursor: hasMore ? ((last?.[cursorField] as string | undefined) ?? null) : null,
  };
}

// -------------------------------------------------------------- reviews ----

export interface Review {
  responseId: string;
  rating: number;
  note: string | null;
  submittedAt: string;
  isRead: boolean;
  isResolved: boolean;
  resolvedAt: string | null;
  noteCount: number;
}

/**
 * Customer responses, newest first.
 *
 * Cursor-paginated on `submitted_at`, which is indexed alongside `org_id`, so
 * this stays a range scan as the table grows. Offset pagination would degrade —
 * and worse, it silently skips or repeats rows when new feedback lands
 * mid-scroll, which in a feedback inbox means an owner never seeing a complaint.
 *
 * Notes are decrypted here, on the server. The plaintext exists only in the HTML
 * rendered for this one signed-in owner; decrypting in the browser would mean
 * shipping the key there.
 */
export async function listReviews(
  orgId: string,
  options: {
    cursor?: string | undefined;
    limit?: number | undefined;
    rating?: number | undefined;
    unreadOnly?: boolean | undefined;
    withNotesOnly?: boolean | undefined;
    openOnly?: boolean | undefined;
  } = {},
): Promise<Page<Review>> {
  const supabase = await supabaseServer();
  const limit = clampLimit(options.limit);

  let query = supabase
    .from("customer_responses")
    .select("id, rating, note_encrypted, submitted_at, read_at, resolved_at")
    .eq("org_id", orgId)
    .order("submitted_at", { ascending: false })
    .limit(limit + 1);

  if (options.cursor) query = query.lt("submitted_at", options.cursor);
  if (options.rating !== undefined) query = query.eq("rating", options.rating);
  if (options.unreadOnly) query = query.is("read_at", null);
  if (options.withNotesOnly) query = query.not("note_encrypted", "is", null);
  if (options.openOnly) query = query.is("resolved_at", null);

  const { data } = await query;
  const rows = data ?? [];

  // How many times the business has acted on each item. Fetched as ids and
  // counted here rather than as a PostgREST aggregate, because the relationship
  // is a composite key and inference over those is the thing that works in
  // development and errors in production.
  const ids = rows.map((row) => row.id as string);
  const { data: noteRows } =
    ids.length > 0
      ? await supabase.from("response_notes").select("response_id").eq("org_id", orgId).in("response_id", ids)
      : { data: [] as Array<{ response_id: string }> };

  const noteCounts = new Map<string, number>();
  for (const row of noteRows ?? []) {
    const key = row.response_id as string;
    noteCounts.set(key, (noteCounts.get(key) ?? 0) + 1);
  }

  return paginate(
    rows,
    limit,
    (row) => ({
      responseId: row.id as string,
      rating: row.rating as number,
      // tryDecrypt, not decrypt: one row encrypted under a rotated key must not
      // take down the whole page.
      note: tryDecrypt(row.note_encrypted as string | null),
      submittedAt: row.submitted_at as string,
      isRead: row.read_at !== null,
      isResolved: row.resolved_at !== null,
      resolvedAt: (row.resolved_at as string | null) ?? null,
      noteCount: noteCounts.get(row.id as string) ?? 0,
    }),
    "submitted_at",
  );
}

// ------------------------------------------------------ action notes ----

export interface ActionNote {
  noteId: string;
  body: string;
  authorName: string;
  authorId: string;
  createdAt: string;
}

/**
 * What the business did about a piece of feedback.
 *
 * Not a reply to the customer — there is nobody to reply to. The public flow
 * collects no email, phone or name, so no row in this schema can be turned into
 * a delivery address. That anonymity is why people write "waited 25 minutes and
 * the order was wrong" instead of writing nothing.
 *
 * What this thread is instead is the record of what happened next, which is the
 * part that changes the business. Appended to, never edited: something that can
 * be quietly rewritten afterwards is not a record.
 */
export async function listActionNotes(orgId: string, responseId: string): Promise<ActionNote[]> {
  const supabase = await supabaseServer();

  const { data } = await supabase
    .from("response_notes")
    .select("id, body_encrypted, author_id, created_at")
    .eq("org_id", orgId)
    .eq("response_id", responseId)
    .order("created_at", { ascending: true });

  const rows = data ?? [];
  const authorIds = [...new Set(rows.map((row) => row.author_id as string))];

  // A separate lookup rather than an embed: `author_id` references auth.users,
  // which PostgREST cannot traverse to public.profiles, so there is no
  // relationship to infer.
  const { data: profiles } =
    authorIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", authorIds)
      : { data: [] as Array<{ id: string; display_name: string | null }> };

  const names = new Map(
    (profiles ?? []).map((profile) => [
      profile.id as string,
      (profile.display_name as string | null)?.trim() || "",
    ]),
  );

  return rows.map((row) => ({
    noteId: row.id as string,
    body: tryDecrypt(row.body_encrypted as string) ?? "",
    // "Someone on your team" rather than a blank byline. A profile can be
    // missing a display name, and an empty name next to an action reads as a
    // rendering bug rather than as missing data.
    authorName: names.get(row.author_id as string) || "Someone on your team",
    authorId: row.author_id as string,
    createdAt: row.created_at as string,
  }));
}

/** One piece of feedback with its full history, for the detail screen. */
export async function getReview(
  orgId: string,
  responseId: string,
): Promise<{ review: Review; actions: ActionNote[] } | null> {
  const supabase = await supabaseServer();

  const { data } = await supabase
    .from("customer_responses")
    .select("id, rating, note_encrypted, submitted_at, read_at, resolved_at")
    .eq("org_id", orgId)
    .eq("id", responseId)
    .maybeSingle();

  // Null covers "does not exist" and "belongs to another tenant" alike. RLS
  // makes them indistinguishable, which is the correct behaviour: telling them
  // apart would confirm that somebody else's feedback exists.
  if (!data) return null;

  const actions = await listActionNotes(orgId, responseId);

  return {
    review: {
      responseId: data.id as string,
      rating: data.rating as number,
      note: tryDecrypt(data.note_encrypted as string | null),
      submittedAt: data.submitted_at as string,
      isRead: data.read_at !== null,
      isResolved: data.resolved_at !== null,
      resolvedAt: (data.resolved_at as string | null) ?? null,
      noteCount: actions.length,
    },
    actions,
  };
}

/** How many responses sit at each star value — the Reviews page breakdown. */
export async function getRatingBreakdown(orgId: string): Promise<{
  counts: Record<1 | 2 | 3 | 4 | 5, number>;
  total: number;
  average: number | null;
}> {
  const supabase = await supabaseServer();

  const results = await Promise.all(
    ([1, 2, 3, 4, 5] as const).map((rating) =>
      supabase
        .from("customer_responses")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("rating", rating),
    ),
  );

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let total = 0;
  let weighted = 0;

  ([1, 2, 3, 4, 5] as const).forEach((rating, index) => {
    const count = results[index]?.count ?? 0;
    counts[rating] = count;
    total += count;
    weighted += count * rating;
  });

  return { counts, total, average: total > 0 ? weighted / total : null };
}

// --------------------------------------------------------------- praise ----

export interface Praise {
  praiseId: string;
  firstName: string;
  note: string | null;
  status: string;
  createdAt: string;
  matchedStaffId: string | null;
  matchedStaffName: string | null;
  isShared: boolean;
}

export interface StaffMember {
  staffId: string;
  name: string;
  roleLabel: string | null;
  isActive: boolean;
}

/**
 * The people who work here.
 *
 * Names are encrypted with a random IV, so the database cannot sort them and
 * ordering happens here after decryption. For a roster of a few dozen that is
 * free; a chain with thousands is the point at which this decision needs
 * revisiting.
 */
export const listStaff = cache(async (orgId: string): Promise<StaffMember[]> => {
  const supabase = await supabaseServer();

  const { data } = await supabase
    .from("staff_members")
    .select("id, name_encrypted, role_label, is_active")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  return (data ?? [])
    .map((row) => ({
      staffId: row.id as string,
      name: tryDecrypt(row.name_encrypted as string) ?? "Unknown",
      roleLabel: (row.role_label as string | null) ?? null,
      isActive: row.is_active as boolean,
    }))
    .sort((a, b) => {
      // Active first, then alphabetical. Someone who has left keeps their
      // history but should not sit at the top of a picker.
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
});

/**
 * Staff a customer named — deliberately without the rating.
 *
 * The absent rating is not a convention that can be forgotten: `team_praise_records`
 * has no rating column and there is no join to `customer_responses` here, so the
 * star is not available to leak. An owner deciding whether to recognise someone
 * should react to what a customer wrote about them, not to a number that may have
 * been about the wait or the parking.
 */
export async function listPraise(
  orgId: string,
  options: {
    cursor?: string | undefined;
    limit?: number | undefined;
    unmatchedOnly?: boolean | undefined;
  } = {},
): Promise<Page<Praise>> {
  const supabase = await supabaseServer();
  const limit = clampLimit(options.limit);

  let query = supabase
    .from("team_praise_records")
    .select(
      "id, first_name_encrypted, praise_note_encrypted, status, created_at, matched_staff_id, shared_at",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options.cursor) query = query.lt("created_at", options.cursor);
  if (options.unmatchedOnly) query = query.eq("status", "unmatched");

  const [{ data }, staff] = await Promise.all([query, listStaff(orgId)]);
  const staffNames = new Map(staff.map((member) => [member.staffId, member.name]));

  return paginate(
    data ?? [],
    limit,
    (row) => {
      const matchedStaffId = (row.matched_staff_id as string | null) ?? null;

      return {
        praiseId: row.id as string,
        firstName: tryDecrypt(row.first_name_encrypted as string) ?? "Someone",
        note: tryDecrypt(row.praise_note_encrypted as string | null),
        status: row.status as string,
        createdAt: row.created_at as string,
        matchedStaffId,
        matchedStaffName: matchedStaffId ? (staffNames.get(matchedStaffId) ?? null) : null,
        isShared: row.shared_at !== null,
      };
    },
    "created_at",
  );
}

export interface StaffPraiseTally {
  staffId: string;
  name: string;
  roleLabel: string | null;
  count: number;
  unshared: number;
}

/**
 * How much praise each person on the team has earned.
 *
 * Counted per matched staff member, not per typed name. Counting raw names would
 * split "Amara" and "amara" into two people and merge two different Sams into
 * one — which is exactly the guesswork the matching step exists to avoid.
 *
 * Only matched praise appears. Something nobody has put a name to is not an
 * achievement yet, it is a decision waiting to be made, and it belongs in the
 * needs-you list rather than silently inflating somebody's total.
 */
export async function getStaffPraiseTally(orgId: string): Promise<StaffPraiseTally[]> {
  const supabase = await supabaseServer();

  const [{ data }, staff] = await Promise.all([
    supabase
      .from("team_praise_records")
      .select("matched_staff_id, shared_at")
      .eq("org_id", orgId)
      .not("matched_staff_id", "is", null),
    listStaff(orgId),
  ]);

  const counts = new Map<string, { count: number; unshared: number }>();
  for (const row of data ?? []) {
    const key = row.matched_staff_id as string;
    const entry = counts.get(key) ?? { count: 0, unshared: 0 };
    entry.count += 1;
    if (row.shared_at === null) entry.unshared += 1;
    counts.set(key, entry);
  }

  return staff
    .map((member) => ({
      staffId: member.staffId,
      name: member.name,
      roleLabel: member.roleLabel,
      count: counts.get(member.staffId)?.count ?? 0,
      unshared: counts.get(member.staffId)?.unshared ?? 0,
    }))
    .filter((member) => member.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// --------------------------------------------------------------- stands ----

export interface Stand {
  standId: string;
  label: string;
  status: string;
  tokenPrefix: string;
  locationName: string | null;
}

/**
 * Every stand, oldest first, so the list order is stable across reloads.
 *
 * The location name comes from a separate lookup rather than an embed:
 * `review_stands` reaches `locations` through a composite key carrying `org_id`,
 * and PostgREST relationship inference over composite keys is exactly the thing
 * that works in development and errors in production. V1 has one location, so
 * this is a single cached read either way.
 */
export const listStands = cache(async (orgId: string): Promise<Stand[]> => {
  const supabase = await supabaseServer();

  const [{ data }, location] = await Promise.all([
    supabase
      .from("review_stands")
      .select("id, label, status, public_token_prefix")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true }),
    getPrimaryLocation(orgId),
  ]);

  return (data ?? []).map((row) => ({
    standId: row.id as string,
    label: (row.label as string) || "Front counter",
    status: row.status as string,
    tokenPrefix: (row.public_token_prefix as string | null) ?? "",
    locationName: location?.name ?? null,
  }));
});

export interface OwnerLocation {
  locationId: string;
  name: string;
  googleReviewUrl: string | null;
}

export const getPrimaryLocation = cache(async (orgId: string): Promise<OwnerLocation | null> => {
  const supabase = await supabaseServer();

  const { data } = await supabase
    .from("locations")
    .select("id, name, google_review_url")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  return {
    locationId: row.id as string,
    name: row.name as string,
    googleReviewUrl: (row.google_review_url as string | null) ?? null,
  };
});

// ------------------------------------------------------------- counters ----

export interface OwnerCounts {
  ratingsToday: number;
  unread: number;
  unmatchedPraise: number;
  activeStands: number;
  recentAverage: number | null;
  recentCount: number;
  hasGoogleLink: boolean;
}

/**
 * Everything Home needs, issued in parallel.
 *
 * Deliberately one function rather than six exported counters: Home needs them
 * together, and issuing them from separate components would serialise them
 * behind each other's awaits.
 */
export const getOwnerCounts = cache(async (orgId: string, timezone: string): Promise<OwnerCounts> => {
  const supabase = await supabaseServer();

  const dayStart = startOfLocalDay(timezone);
  const monthStart = startOfLocalMonth(timezone);

  const [today, unread, praise, stands, location, recent] = await Promise.all([
    supabase
      .from("customer_responses")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gte("submitted_at", dayStart.toISOString()),
    supabase
      .from("customer_responses")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("read_at", null),
    supabase
      .from("team_praise_records")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "unmatched")
      .gte("created_at", monthStart.toISOString()),
    supabase.from("review_stands").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active"),
    getPrimaryLocation(orgId),
    supabase
      .from("customer_responses")
      .select("rating")
      .eq("org_id", orgId)
      .order("submitted_at", { ascending: false })
      .limit(50),
  ]);

  const ratings = (recent.data ?? []).map((row) => row.rating as number);

  return {
    ratingsToday: today.count ?? 0,
    unread: unread.count ?? 0,
    unmatchedPraise: praise.count ?? 0,
    activeStands: stands.count ?? 0,
    recentAverage:
      ratings.length > 0
        ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length
        : null,
    recentCount: ratings.length,
    hasGoogleLink: Boolean(location?.googleReviewUrl),
  };
});

// ------------------------------------------------------------ customers ----

export interface CustomerVisit {
  responseId: string;
  rating: number;
  submittedAt: string;
  leftNote: boolean;
  clickedGoogle: boolean;
  praisedSomeone: boolean;
  standLabel: string | null;
}

/**
 * Visits, not people.
 *
 * A deliberate and important distinction. The public flow collects no name, no
 * phone number and no email — by design — so there is no way to know that two
 * visits were the same person, and pretending otherwise would be inventing data.
 * Calling the screen "Customers" is fine; storing it as if we held identities
 * would not be.
 *
 * What this can honestly show is what happened on each visit: the rating,
 * whether they wrote something, whether they went on to Google, whether they
 * thanked a member of staff.
 *
 * The follow-up lookups are explicit `in` queries rather than PostgREST embeds.
 * Those tables reference `customer_responses` through *composite* foreign keys
 * carrying `org_id`, and relationship inference over composite keys is exactly
 * the kind of thing that resolves in development and returns an ambiguity error
 * in production. Two indexed lookups over at most 50 ids is a rounding error.
 */
export async function listVisits(
  orgId: string,
  options: { cursor?: string | undefined; limit?: number | undefined } = {},
): Promise<Page<CustomerVisit>> {
  const supabase = await supabaseServer();
  const limit = clampLimit(options.limit);

  let query = supabase
    .from("customer_responses")
    .select("id, rating, note_encrypted, submitted_at, stand_id")
    .eq("org_id", orgId)
    .order("submitted_at", { ascending: false })
    .limit(limit + 1);

  if (options.cursor) query = query.lt("submitted_at", options.cursor);

  const { data } = await query;
  const rows = data ?? [];
  const ids = rows.map((row) => row.id as string);

  const [clicks, praise, stands] = await Promise.all([
    ids.length > 0
      ? supabase.from("google_review_clicks").select("response_id").eq("org_id", orgId).in("response_id", ids)
      : Promise.resolve({ data: [] as Array<{ response_id: string }> }),
    ids.length > 0
      ? supabase.from("team_praise_records").select("response_id").eq("org_id", orgId).in("response_id", ids)
      : Promise.resolve({ data: [] as Array<{ response_id: string }> }),
    listStands(orgId),
  ]);

  const clicked = new Set((clicks.data ?? []).map((row) => row.response_id as string));
  const praised = new Set((praise.data ?? []).map((row) => row.response_id as string));
  const standLabels = new Map(stands.map((stand) => [stand.standId, stand.label]));

  return paginate(
    rows,
    limit,
    (row) => ({
      responseId: row.id as string,
      rating: row.rating as number,
      submittedAt: row.submitted_at as string,
      // Whether a note exists, never the note itself. This screen is a summary,
      // and decrypting fifty notes to render fifty booleans is wasted work on
      // data that should not leave the feedback screen anyway.
      leftNote: row.note_encrypted !== null,
      clickedGoogle: clicked.has(row.id as string),
      praisedSomeone: praised.has(row.id as string),
      standLabel: standLabels.get(row.stand_id as string) ?? null,
    }),
    "submitted_at",
  );
}

/**
 * How visits turn into Google reviews.
 *
 * NOT an "intercept rate" and never presented as one. This counts how many
 * people took the opportunity, which every rating is offered identically — it is
 * a measure of how well the invitation works, not of how well we filter anyone.
 * The moment this number is broken down by star rating it becomes a gating
 * metric, so it is not, and must not be.
 */
export async function getVisitSummary(orgId: string): Promise<{
  visits: number;
  wroteNote: number;
  wentToGoogle: number;
  thankedStaff: number;
}> {
  const supabase = await supabaseServer();

  const [visits, notes, clicks, praise] = await Promise.all([
    supabase.from("customer_responses").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase
      .from("customer_responses")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .not("note_encrypted", "is", null),
    supabase.from("google_review_clicks").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("team_praise_records").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);

  return {
    visits: visits.count ?? 0,
    wroteNote: notes.count ?? 0,
    wentToGoogle: clicks.count ?? 0,
    thankedStaff: praise.count ?? 0,
  };
}
