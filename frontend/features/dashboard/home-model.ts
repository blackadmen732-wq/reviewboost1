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

export interface HomeModel {
  kind: HomeKind;
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

export function summarizeTags(stands: HomeStand[]): TagStatus {
  return {
    total: stands.length,
    live: stands.filter((stand) => stand.status === "active").length,
    programmed: stands.filter((stand) => stand.nfcProvisionedAt !== null).length,
    needsRewrite: stands.filter(tagNeedsRewrite).length,
  };
}

export function deriveHomeModel({
  counts,
  stands,
  hasLocation,
}: {
  counts: HomeCounts;
  stands: HomeStand[];
  hasLocation: boolean;
}): HomeModel {
  const kind: HomeKind = isHomeEmpty(counts) ? "empty" : "active";
  const tags = summarizeTags(stands);
  const hasStand = tags.live > 0 || tags.total > 0;
  const previewStand = stands.find((stand) => stand.status === "active") ?? stands[0] ?? null;

  const googleHref = hasLocation ? "/settings" : "/onboarding";
  const createHref = hasLocation ? "/stands" : "/onboarding";

  const attentions: Attention[] = [];

  if (counts.unread > 0) {
    attentions.push({
      kind: "unread",
      title: counts.unread === 1 ? "1 message needs you" : `${counts.unread} messages need you`,
      body: "Read them before the next rush.",
    });
  }

  if (!hasStand) {
    attentions.push({
      kind: "tag-missing",
      title: "No tag yet",
      body: "Create a Tag and put it where people pay.",
    });
  }

  if (!counts.hasGoogleLink) {
    attentions.push({
      kind: "google",
      title: counts.googleLinkInvalid ? "That Google link is wrong" : "Google link is missing",
      body: counts.googleLinkInvalid
        ? GOOGLE_LINK_INVALID
        : "Set it in Settings. Every Tag uses this one link.",
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

  if (kind === "empty" && counts.hasGoogleLink && hasStand && tags.programmed > 0 && tags.needsRewrite === 0) {
    primary = null;
  }

  return {
    kind,
    attentions,
    primary,
    showPreview: hasStand,
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
