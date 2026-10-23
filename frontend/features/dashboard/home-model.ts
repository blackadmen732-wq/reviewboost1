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
    | "Add Google link"
    | "Program a tag"
    | "Read feedback"
    | "Choose a plan"
    | "Update payment"
    | "Open Billing";
  href: "/stands" | "/onboarding" | "/feedback" | "/settings" | "/settings/billing";
}

export type TagProgramPhase = "not-programmed" | "programmed" | "needs-reprogramming";

/**
 * The new-owner path on Home is Set up's own three steps (setup-model), drawn
 * small. Home used to keep a five-step list of its own, so the same business
 * read "1 of 5" on Home and "0 of 3 done" on Set up at the same moment.
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
  tagStatus: TagStatus;
  headline: string | null;
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

export function deriveHomeModel({
  counts,
  stands,
  hasLocation,
  canManage = true,
  hasCustomerPhoto = null,
  service = "unknown",
  canManageBilling = false,
}: {
  counts: HomeCounts;
  stands: HomeStand[];
  hasLocation: boolean;
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
    attentions.push({
      kind: "google",
      title: counts.googleLinkInvalid ? "That Google link is wrong" : "Google link is missing",
      body: counts.googleLinkInvalid
        ? GOOGLE_LINK_INVALID
        : "Set it in Settings. Until then, those Tags send nobody to Google.",
    });
  }

  if (hasStand && tags.needsRewrite > 0) {
    attentions.push({
      kind: "tag-rewrite",
      title: tags.needsRewrite === 1 ? "One tag needs reprogramming" : `${tags.needsRewrite} tags need reprogramming`,
      body: "The code changed. Program the tag again, or reprint the code.",
    });
  } else if (hasStand && tags.programmed === 0) {
    attentions.push({
      kind: "tag-unprogrammed",
      title: "Tag is not programmed yet",
      body: "Print the code or program the tag. Same link either way.",
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
      body: "It still works. It opens your Google listing rather than the review box — swap it for your “Ask for reviews” link in Settings. Your Tags stay the same.",
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
    primary = { label: "Program a tag", href: "/stands" };
  } else if (kind === "empty" || tags.programmed === 0) {
    primary = { label: "Print your code", href: "/stands" };
  } else {
    primary = null;
  }

  if (!canManage && primary?.href !== "/feedback") primary = null;

  // Ready empty: Google is set, a tag exists and is programmed. Waiting.
  if (kind === "empty" && counts.hasGoogleLink && hasStand && tags.programmed > 0 && tags.needsRewrite === 0) {
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
    tagStatus: tags,
    headline: ratingsHeadline(counts),
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

export function ratingsHeadline(counts: Pick<HomeCounts, "ratingsThisWeek" | "ratingsLastWeek">): string | null {
  const thisWeek = counts.ratingsThisWeek;
  if (thisWeek == null) return null;
  const lastWeek = counts.ratingsLastWeek ?? 0;
  const word = thisWeek === 1 ? "rating" : "ratings";
  if (lastWeek === 0) {
    return thisWeek === 0 ? null : `${thisWeek} ${word} this week`;
  }
  const delta = thisWeek - lastWeek;
  if (delta === 0) return `${thisWeek} ${word} this week, same as last week`;
  if (delta > 0) return `${thisWeek} ${word} this week, up ${delta}`;
  return `${thisWeek} ${word} this week, down ${Math.abs(delta)}`;
}

export function tagStatusLine(status: TagStatus): string {
  if (status.total === 0) return "No tags yet";
  if (status.live === 0) {
    return status.total === 1 ? "1 tag, none live" : `${status.total} tags, none live`;
  }

  const tagWord = status.total === 1 ? "tag" : "tags";
  const parts = [`${status.total} ${tagWord}`];
  if (status.needsRewrite > 0) {
    parts.push(status.needsRewrite === 1 ? "1 needs reprogramming" : `${status.needsRewrite} need reprogramming`);
  } else if (status.programmed > 0) {
    parts.push(status.programmed === 1 ? "1 programmed" : `${status.programmed} programmed`);
  } else {
    parts.push("not programmed yet");
  }
  return parts.join(" · ");
}
