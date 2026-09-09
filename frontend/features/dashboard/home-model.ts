/**
 * Pure Home decisions. The page fetches; this file only answers what to show.
 *
 * Empty vs active is "has anyone rated yet", not "did they finish onboarding".
 * Fake counts never enter this model.
 */

export interface HomeCounts {
  ratingsToday: number;
  unread: number;
  activeStands: number;
  recentCount: number;
  hasGoogleLink: boolean;
}

export interface HomeStand {
  standId: string;
  label: string;
  status: string;
  nfcProvisionedAt: string | null;
  tokenRotatedAt: string | null;
}

export type HomeKind = "empty" | "active";

export type AttentionKind = "google" | "unread" | "tag-missing" | "tag-rewrite";

export interface Attention {
  kind: AttentionKind;
  title: string;
  body: string;
}

export interface HomePrimary {
  label: "Create a Tag" | "Print your code" | "Finish setup" | "Read feedback";
  href: "/stands" | "/onboarding" | "/feedback";
}

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
}

export function isHomeEmpty(counts: Pick<HomeCounts, "recentCount" | "ratingsToday">): boolean {
  return counts.recentCount === 0 && counts.ratingsToday === 0;
}

export function tagNeedsRewrite(stand: HomeStand): boolean {
  if (stand.nfcProvisionedAt === null || stand.tokenRotatedAt === null) return false;
  return new Date(stand.tokenRotatedAt) > new Date(stand.nfcProvisionedAt);
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

  const attentions: Attention[] = [];
  if (!counts.hasGoogleLink) {
    attentions.push({
      kind: "google",
      title: "Google review link is missing",
      body: "Customers can rate you here. They cannot be sent to Google until the link is added.",
    });
  }
  if (!hasStand) {
    attentions.push({
      kind: "tag-missing",
      title: "No tag yet",
      body: "Create a tag or print a code and put it where people pay.",
    });
  } else if (tags.needsRewrite > 0) {
    attentions.push({
      kind: "tag-rewrite",
      title: tags.needsRewrite === 1 ? "One tag needs reprogramming" : `${tags.needsRewrite} tags need reprogramming`,
      body: "The code changed after the last NFC write. Rewrite the tag or reprint the code.",
    });
  }
  if (counts.unread > 0) {
    attentions.push({
      kind: "unread",
      title: counts.unread === 1 ? "1 message needs you" : `${counts.unread} messages need you`,
      body: "Read them before the next rush.",
    });
  }

  const createHref = hasLocation ? "/stands" : "/onboarding";

  let primary: HomePrimary | null;
  if (kind === "empty") {
    primary = hasStand
      ? { label: "Print your code", href: "/stands" }
      : { label: "Create a Tag", href: createHref };
  } else if (counts.unread > 0) {
    primary = { label: "Read feedback", href: "/feedback" };
  } else if (!counts.hasGoogleLink) {
    primary = { label: "Finish setup", href: "/onboarding" };
  } else if (!hasStand) {
    primary = { label: "Create a Tag", href: createHref };
  } else {
    primary = null;
  }

  return {
    kind,
    attentions,
    primary,
    showPreview: hasStand,
    previewStandId: previewStand?.standId ?? null,
    tagStatus: tags,
  };
}

export function tagStatusLine(status: TagStatus): string {
  if (status.total === 0) return "No tags yet";

  const tagWord = status.total === 1 ? "tag" : "tags";
  const parts = [`${status.total} ${tagWord}`];
  if (status.programmed > 0) {
    parts.push(
      status.programmed === 1 ? "1 programmed" : `${status.programmed} programmed`,
    );
  } else {
    parts.push("not programmed yet");
  }
  if (status.needsRewrite > 0) {
    parts.push(status.needsRewrite === 1 ? "1 needs a rewrite" : `${status.needsRewrite} need a rewrite`);
  }
  return parts.join(" · ");
}
