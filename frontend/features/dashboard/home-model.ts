/**
 * Pure Home decisions. The page fetches; this file only answers what to show.
 *
 * Empty vs active is "has anyone rated yet", not "did they finish onboarding".
 * Fake counts never enter this model.
 */

import { GOOGLE_LINK_INVALID } from "@/features/dashboard/google-link-copy";

export interface HomeCounts {
  ratingsToday: number;
  unread: number;
  activeStands: number;
  recentCount: number;
  hasGoogleLink: boolean;
  googleLinkInvalid?: boolean;
  ratingsThisWeek?: number;
  ratingsLastWeek?: number;
}

export interface HomeStand {
  standId: string;
  label: string;
  status: string;
  nfcProvisionedAt: string | null;
  tokenRotatedAt: string | null;
}

export type HomeKind = "empty" | "active";

export type AttentionKind =
  | "google"
  | "unread"
  | "tag-missing"
  | "tag-unprogrammed"
  | "tag-rewrite";

export interface Attention {
  kind: AttentionKind;
  title: string;
  body: string;
}

export interface HomePrimary {
  label: "Create a Tag" | "Print your code" | "Add Google link" | "Program a tag" | "Read feedback";
  href: "/stands" | "/onboarding" | "/feedback" | "/settings";
}

export type TagProgramPhase = "not-programmed" | "programmed" | "needs-reprogramming";

export interface TagStatus {
  total: number;
  live: number;
  programmed: number;
  needsRewrite: number;
}

/**
 * The new-owner path, from real state only. Each step is done when the data
 * says so — nothing is ticked because a button was pressed. Printing a code is
 * not recorded anywhere, so step three completes on NFC or, like the rest,
 * when the first rating arrives and Home stops showing setup at all.
 */
export type SetupStepKey = "tag" | "google" | "photo" | "print" | "first-rating";

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  done: boolean;
  /**
   * Where to do it, for a step that is optional and so never takes the one
   * green button. Only the photo step has one, and only while it is undone.
   */
  href?: "/customer-page";
}

export interface HomeModel {
  kind: HomeKind;
  /** Only for a Home with no ratings yet. */
  setup: SetupStep[] | null;
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

export function tagNeedsRewrite(stand: HomeStand): boolean {
  if (stand.nfcProvisionedAt === null || stand.tokenRotatedAt === null) return false;
  return new Date(stand.tokenRotatedAt) > new Date(stand.nfcProvisionedAt);
}

export function tagProgramPhase(stand: HomeStand): TagProgramPhase {
  if (stand.nfcProvisionedAt === null) return "not-programmed";
  if (tagNeedsRewrite(stand)) return "needs-reprogramming";
  return "programmed";
}

export function tagProgramPhaseLabel(phase: TagProgramPhase): string {
  if (phase === "not-programmed") return "Not programmed";
  if (phase === "needs-reprogramming") return "Needs reprogramming";
  return "Programmed";
}

/**
 * Only an active Tag is doing anything for the business.
 *
 * programmed and needsRewrite deliberately count active Tags alone. A retired
 * Tag whose code has moved on is not work anybody should be nagged about, and
 * counting a paused one as programmed made setup look finished while nothing on
 * the counter actually worked. `total` stays every Tag, because the list still
 * shows them.
 */
export function summarizeTags(stands: HomeStand[]): TagStatus {
  const active = stands.filter((stand) => stand.status === "active");
  return {
    total: stands.length,
    live: active.length,
    programmed: active.filter((stand) => stand.nfcProvisionedAt !== null).length,
    needsRewrite: active.filter(tagNeedsRewrite).length,
  };
}

export function deriveHomeModel({
  counts,
  stands,
  hasLocation,
  canManage = true,
  hasCustomerPhoto = null,
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

  // Returning work first so unread is the headline when there is any.
  if (counts.unread > 0) {
    attentions.push({
      kind: "unread",
      // Ratings, not "messages": the customer page collects a star and nothing
      // else, and Home must not promise words that are not there.
      title: counts.unread === 1 ? "1 new rating" : `${counts.unread} new ratings`,
      body: counts.unread === 1 ? "See it before the next rush." : "See them before the next rush.",
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

  let primary: HomePrimary | null;
  if (counts.unread > 0 && kind === "active") {
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

  const setup: SetupStep[] | null =
    kind === "empty"
      ? [
          { key: "tag", title: "Create your first Tag", done: hasStand },
          { key: "google", title: "Add your Google review link", done: counts.hasGoogleLink },
          ...(hasCustomerPhoto === null
            ? []
            : [
                {
                  key: "photo" as const,
                  title: "Add your photo to the customer page",
                  done: hasCustomerPhoto,
                  ...(!hasCustomerPhoto && canManage ? { href: "/customer-page" as const } : {}),
                },
              ]),
          { key: "print", title: "Print the code or program NFC", done: tags.programmed > 0 },
          { key: "first-rating", title: "Get your first rating", done: false },
        ]
      : null;

  return {
    kind,
    setup,
    attentions,
    primary,
    showPreview: hasStand && canManage,
    previewStandId: previewStand?.standId ?? null,
    tagStatus: tags,
    headline: ratingsHeadline(counts),
  };
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
