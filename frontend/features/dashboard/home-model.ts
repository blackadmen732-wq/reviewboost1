/**
 * Pure Home decisions. The page fetches; this file only answers what to show.
 *
 * Empty vs active is "has anyone rated yet", not "did they finish onboarding".
 * Fake counts never enter this model.
 */

import { serviceNotice, tagsServeCustomers, type ServiceKind } from "@/lib/owner/service-state";
import { summarizeTags, type HomeStand, type TagStatus } from "@/lib/owner/tag-summary";
import { tagNeedsRewrite } from "@/lib/owner/tag-readiness";
import { deriveSetupSteps, type SetupStepView } from "@/features/setup/setup-model";

import { GOOGLE_LINK_INVALID } from "@/features/dashboard/google-link-copy";

export interface HomeCounts {
  ratingsToday: number;
  unread: number;
  /** Of `unread`, how many are three stars or fewer. Absent in older callers. */
  unreadLow?: number;
  /** Three stars or fewer and not yet sorted, read or not. */
  openLow?: number;
  activeStands: number;
  recentCount: number;
  hasGoogleLink: boolean;
  googleLinkInvalid?: boolean;
  /** A place's link works but is a listing or short link, not a review link. */
  googleLinkNeedsUpgrade?: boolean;
  ratingsThisWeek?: number;
  ratingsLastWeek?: number;
  /** People who tapped or scanned a Tag this week. Absent in older callers. */
  tapsThisWeek?: number;
}

export type HomeKind = "empty" | "active";

export type AttentionKind =
  | "plan"
  | "payment"
  | "google"
  | "google-upgrade"
  | "unread"
  | "unsorted"
  | "tag-missing"
  | "tag-unprogrammed"
  | "tag-rewrite";

export interface Attention {
  kind: AttentionKind;
  title: string;
  body: string;
}

export interface HomePrimary {
  label:
    | "Create a Tag"
    | "Print your code"
    // The app's word for the same button: it shows the code, the website prints.
    | "Show your code"
    | "Add Google link"
    | "Set up tap"
    | "Read feedback"
    | "Choose a plan"
    | "Update payment"
    | "Open Billing";
  href: "/stands" | `/stands/${string}` | "/onboarding" | "/feedback" | "/settings" | "/settings/billing";
}

export type TagProgramPhase = "not-programmed" | "programmed" | "needs-reprogramming";

/**
 * The new-owner path on Home is the Tags page's own three steps (setup-model), drawn
 * small. Home used to keep a five-step list of its own, so the same business
 * read "1 of 5" on Home and "0 of 3 done" on Tags at the same moment.
 */
export type SetupStep = SetupStepView;
export type SetupStepKey = SetupStepView["key"];

export interface HomeModel {
  kind: HomeKind;
  /** Only for a Home with no ratings yet. */
  setup: SetupStep[] | null;
  /**
   * The photo is optional, so it is not a step: a quiet link under them while
   * the published page has none, for someone who may edit it.
   */
  photoNudge: boolean;
  /**
   * The plan, while it waits behind unfinished setup: said under the steps
   * rather than over them, with a link for the owner.
   */
  planNote: { title: string; href: "/settings/billing" | null } | null;
  attentions: Attention[];
  primary: HomePrimary | null;
  showPreview: boolean;
  previewStandId: string | null;
  /** The Tags are off for want of a plan, so the preview shows the closed screen. */
  previewClosed?: boolean;
  tagStatus: TagStatus;
  week: WeekNumbers | null;
}

export function isHomeEmpty(counts: Pick<HomeCounts, "recentCount" | "ratingsToday">): boolean {
  return counts.recentCount === 0 && counts.ratingsToday === 0;
}

export { tagNeedsRewrite, summarizeTags };
export type { HomeStand, TagStatus };

export function tagProgramPhase(stand: HomeStand): TagProgramPhase {
  if (tagNeedsRewrite(stand)) return "needs-reprogramming";
  if (stand.nfcProvisionedAt === null) return "not-programmed";
  return "programmed";
}

export function tagProgramPhaseLabel(phase: TagProgramPhase): string {
  if (phase === "not-programmed") return "Not programmed";
  if (phase === "needs-reprogramming") return "Needs reprogramming";
  return "Programmed";
}

/** "High Street", "High Street and Mall", "A, B and C". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function deriveHomeModel({
  counts,
  stands,
  hasLocation,
  canManage = true,
  hasCustomerPhoto = null,
  service = "unknown",
  canManageBilling = false,
  placesWithoutGoogleLink = [],
}: {
  counts: HomeCounts;
  stands: HomeStand[];
  hasLocation: boolean;
  /**
   * With two or more places, the ones whose Google link is missing, by name,
   * so "Google link is missing" says where. Empty for a single place.
   */
  placesWithoutGoogleLink?: readonly string[];
  /**
   * Whether a published Customer Page carries the business's photo. Null when
   * it could not be read: the step is left out rather than shown wrong.
   */
  hasCustomerPhoto?: boolean | null;
  /**
   * Owner or admin. Creating and programming Tags, the Google link and the
   * customer-page preview are all refused to anyone else by the API, so a
   * member or viewer is shown what needs doing but not a button to do it —
   * reading feedback is the one action every role has.
   */
  canManage?: boolean;
  /**
   * Whether the Tags open for customers (lib/owner/service-state). A closed
   * door outranks everything: nothing else on Home matters while every scan
   * says "This review link isn't active".
   */
  service?: ServiceKind;
  /** Owner only: the Billing API refuses everyone else. */
  canManageBilling?: boolean;
}): HomeModel {
  const kind: HomeKind = isHomeEmpty(counts) ? "empty" : "active";
  const tags = summarizeTags(stands);
  // Readiness is about a Tag a customer can actually tap. A paused or retired
  // one used to satisfy this through `|| tags.total > 0`, so an org whose only
  // Tag was retired saw a finished setup and no prompt to fix it.
  const hasStand = tags.live > 0;
  // The preview opens the live customer page, so it can only be an active Tag.
  // Falling back to stands[0] offered a preview that would not resolve.
  const previewStand = stands.find((stand) => stand.status === "active") ?? null;

  const googleHref = hasLocation ? "/settings" : "/onboarding";
  const createHref = hasLocation ? "/stands" : "/onboarding";

  const attentions: Attention[] = [];

  // Billing first: a closed door makes every other line on Home moot, and a
  // failed card is the one thing that will close it if nobody acts. The one
  // exception is a business that has never had a plan and is still setting
  // up: it is meant to finish setting up, see its page, and then be asked for
  // a card (migration 20260915001400), so the plan waits behind the setup
  // steps, still said, until they are done.
  const billing = serviceNotice(service);
  const planFirst = billing !== null && (service !== "no-plan" || (hasStand && counts.hasGoogleLink));
  if (billing && planFirst) attentions.push({ kind: billing.kind, title: billing.title, body: billing.body });

  // Returning work next so unread is the headline when there is any.
  if (counts.unread > 0) {
    attentions.push({
      kind: "unread",
      // Ratings, not "messages": the customer page collects a star and nothing
      // else, and Home must not promise words that are not there.
      title: counts.unread === 1 ? "1 new rating" : `${counts.unread} new ratings`,
      body: unreadBody(counts.unread, counts.unreadLow),
    });
  } else if ((counts.openLow ?? 0) > 0) {
    // Read, but not dealt with: Feedback's "Needs you" still holds them, so
    // Home must not say "Nothing needs you" over the top of them.
    const open = counts.openLow ?? 0;
    attentions.push({
      kind: "unsorted",
      title: open === 1 ? "1 low rating isn’t sorted yet" : `${open} low ratings aren’t sorted yet`,
      body: "Mark each one sorted once you’ve dealt with it.",
    });
  }

  // Empty path: create a tag first. Google is the headline only once a tag exists.
  if (!hasStand) {
    attentions.push({
      kind: "tag-missing",
      title: tags.total > 0 ? "No Tag is live" : "No tag yet",
      body:
        tags.total > 0
          ? "Every Tag is paused or retired, so nothing on the counter works. Make one live again, or create a Tag."
          : "Create a Tag and put it where people pay.",
    });
  }

  if (!counts.hasGoogleLink) {
    const where = placesWithoutGoogleLink.length > 0 ? ` for ${listNames(placesWithoutGoogleLink)}` : "";
    attentions.push({
      kind: "google",
      title: counts.googleLinkInvalid
        ? "That Google link is wrong"
        : `Google link is missing${where}`,
      // No link means no destination, and the customer page then shows
      // "This review link isn't active": nobody can rate, not only "nobody
      // goes to Google".
      body: counts.googleLinkInvalid
        ? GOOGLE_LINK_INVALID
        : "Add it in Settings. Until then, a scan shows “This review link isn’t active”.",
    });
  }

  if (hasStand && tags.needsRewrite > 0) {
    attentions.push({
      kind: "tag-rewrite",
      title: tags.needsRewrite === 1 ? "One Tag has a new code" : `${tags.needsRewrite} Tags have a new code`,
      body: "The old code stopped working. Reprint it and set up tap again.",
    });
  } else if (hasStand && tags.inUse === 0) {
    attentions.push({
      kind: "tag-unprogrammed",
      title: "Your Tag isn’t set up yet",
      body: "Print the code or set up tap. Same link either way.",
    });
  }

  if (billing && !planFirst) attentions.push({ kind: billing.kind, title: billing.title, body: billing.body });

  // Working, so it never blocks setup or takes the one green button; it is a
  // note that a better link exists, listed after everything that
  // actually stops a Tag working. Tags are untouched either way.
  if (counts.hasGoogleLink && counts.googleLinkNeedsUpgrade) {
    attentions.push({
      kind: "google-upgrade",
      title: "Upgrade your Google link",
      body: "It still works. It opens your Google listing rather than the review box — swap it for your “Get more reviews” link in Settings. Your Tags stay the same.",
    });
  }

  let primary: HomePrimary | null;
  if ((counts.unread > 0 || (counts.openLow ?? 0) > 0) && kind === "active") {
    primary = { label: "Read feedback", href: "/feedback" };
  } else if (!hasStand) {
    primary = { label: "Create a Tag", href: createHref };
  } else if (!counts.hasGoogleLink) {
    primary = { label: "Add Google link", href: googleHref };
  } else if (tags.needsRewrite > 0) {
    primary = { label: "Set up tap", href: "/stands" };
  } else if (kind === "empty" || tags.inUse === 0) {
    // Straight to the Tag, whose first tile prints: not the list of Tags.
    primary = {
      label: "Print your code",
      href: previewStand ? `/stands/${previewStand.standId}` : "/stands",
    };
  } else {
    primary = null;
  }

  if (!canManage && primary?.href !== "/feedback") primary = null;

  // Ready empty: Google is set, a tag exists and is programmed. Waiting.
  if (kind === "empty" && counts.hasGoogleLink && hasStand && tags.inUse > 0 && tags.needsRewrite === 0) {
    primary = null;
  }

  // Only the owner can change the plan, so only the owner gets the button;
  // anyone else still reads why the Tags are off.
  if (billing && planFirst && canManageBilling) primary = { ...billing.action };

  const setup: SetupStep[] | null =
    kind === "empty"
      ? deriveSetupSteps({
          hasGoogleLink: counts.hasGoogleLink,
          hasCustomerPhoto,
          hasLocation,
          stands,
          hasAnyRating: false,
          canManage,
          serving: tagsServeCustomers(service),
        })
      : null;

  return {
    kind,
    setup,
    photoNudge: kind === "empty" && hasCustomerPhoto === false && canManage,
    planNote: billing && !planFirst ? { title: billing.title, href: canManageBilling ? billing.action.href : null } : null,
    attentions,
    primary,
    showPreview: hasStand && canManage,
    previewStandId: previewStand?.standId ?? null,
    previewClosed: !tagsServeCustomers(service),
    tagStatus: tags,
    week: weekNumbers(counts),
  };
}

/**
 * Which of the new ratings to read first, in numbers. "4 new ratings" alone
 * reads the same for four 5-stars as for four complaints.
 */
export function unreadBody(unread: number, low: number | undefined): string {
  const rush = unread === 1 ? "See it before the next rush." : "See them before the next rush.";
  if (low === undefined) return rush;
  const later = "Have a look when you get a minute.";
  if (low === 0) return unread === 1 ? `A 4 or 5-star rating. ${later}` : `All 4 or 5 stars. ${later}`;
  if (unread === 1) return `It’s 3 stars or fewer. ${rush}`;
  if (low === unread) return `All ${unread} are 3 stars or fewer. ${rush}`;
  return `${low} ${low === 1 ? "is" : "are"} 3 stars or fewer. ${rush}`;
}

/**
 * This week's count, and how it compares, in words. "Down 1" made people ask
 * "down 1 what?", so the comparison names last week every time.
 */
export interface WeekNumbers {
  /** Ratings this week. */
  count: number;
  /** "3 more than last week", "1 fewer than last week", "Same as last week". */
  change: string | null;
  /**
   * People who tapped or scanned a Tag this week, or null where they were not
   * counted. A week of taps and no ratings still shows: that gap is the news.
   */
  taps: number | null;
}

export function weekNumbers(
  counts: Pick<HomeCounts, "ratingsThisWeek" | "ratingsLastWeek" | "tapsThisWeek">,
): WeekNumbers | null {
  const thisWeek = counts.ratingsThisWeek;
  if (thisWeek == null) return null;
  const taps = counts.tapsThisWeek ?? null;
  const lastWeek = counts.ratingsLastWeek ?? 0;
  if (lastWeek === 0) return thisWeek === 0 && !taps ? null : { count: thisWeek, change: null, taps };
  const delta = thisWeek - lastWeek;
  if (delta === 0) return { count: thisWeek, change: "Same as last week", taps };
  return { count: thisWeek, change: `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"} than last week`, taps };
}

/** The tile's words for this week: taps first when they are counted. */
export function weekTile(week: WeekNumbers): { value: string; unit: string; note: string | null } {
  if (week.taps === null) {
    return { value: String(week.count), unit: week.count === 1 ? "rating" : "ratings", note: week.change };
  }
  return { value: String(week.taps), unit: week.taps === 1 ? "tap" : "taps", note: `${week.count} rated` };
}

export function tagStatusLine(status: TagStatus): string {
  if (status.total === 0) return "No Tags yet";
  if (status.live === 0) {
    return status.total === 1 ? "1 Tag, none live" : `${status.total} Tags, none live`;
  }

  const tagWord = status.total === 1 ? "Tag" : "Tags";
  const parts = [`${status.total} ${tagWord}`];
  if (status.needsRewrite > 0) {
    parts.push(status.needsRewrite === 1 ? "1 has a new code" : `${status.needsRewrite} have a new code`);
  } else if (status.programmed > 0) {
    parts.push(status.programmed === 1 ? "1 ready to tap" : `${status.programmed} ready to tap`);
  } else if (status.inUse > 0) {
    // Working by its printed code: nothing is wrong, tap is optional.
    parts.push(status.inUse === 1 ? "1 in use" : `${status.inUse} in use`);
  } else {
    parts.push("tap not set up yet");
  }
  return parts.join(" · ");
}
