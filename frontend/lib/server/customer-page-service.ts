import "server-only";

import { clampHeroTransform, type HeroTransform } from "@/lib/owner/hero-transform";
import {
  EMPTY_PRESENTATION,
  presentationFromUnknown,
  type CustomerPresentation,
} from "@/lib/owner/public-customer";
import type { AuthenticatedContext } from "@/lib/server/auth";
import { digestStandToken, digestStandTokenWithPreviousKey } from "@/lib/server/crypto";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

export interface CustomerPageState {
  draft: HeroTransform;
  draftTagline: string | null;
  hasDraftHero: boolean;
  published: HeroTransform;
  publishedTagline: string | null;
  hasPublishedHero: boolean;
  publishedAt: string | null;
  draftArtworkUrl: string;
  liveArtworkUrl: string;
}

function fail(context: string, error: unknown): never {
  logger.error("customer_page.error", { context, error });
  throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data) && data[0]) return data[0] as T;
  if (data && typeof data === "object") return data as T;
  return null;
}

export async function getCustomerPageState(
  context: AuthenticatedContext,
): Promise<CustomerPageState> {
  const { data, error } = await context.db.rpc("rpc_get_customer_page");
  if (error) {
    if (error.message?.includes("not_found_or_forbidden")) {
      throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change the customer page.");
    }
    fail("get_customer_page", error);
  }

  const row = firstRow<{
    draft_offset_x: number;
    draft_offset_y: number;
    draft_scale: number;
    draft_tagline: string | null;
    has_draft_hero: boolean;
    published_offset_x: number;
    published_offset_y: number;
    published_scale: number;
    published_tagline: string | null;
    has_published_hero: boolean;
    published_at: string | null;
  }>(data);

  return {
    draft: clampHeroTransform({
      x: row?.draft_offset_x ?? 0,
      y: row?.draft_offset_y ?? 0,
      scale: row?.draft_scale ?? 1,
    }),
    draftTagline: row?.draft_tagline ?? null,
    hasDraftHero: Boolean(row?.has_draft_hero),
    published: clampHeroTransform({
      x: row?.published_offset_x ?? 0,
      y: row?.published_offset_y ?? 0,
      scale: row?.published_scale ?? 1,
    }),
    publishedTagline: row?.published_tagline ?? null,
    hasPublishedHero: Boolean(row?.has_published_hero),
    publishedAt: row?.published_at ?? null,
    draftArtworkUrl: "/api/v1/customer-page/artwork?side=draft",
    liveArtworkUrl: "/api/v1/customer-page/artwork?side=published",
  };
}

export async function saveCustomerPageDraft(
  context: AuthenticatedContext,
  input: { transform: HeroTransform; tagline?: string | null },
): Promise<void> {
  const transform = clampHeroTransform(input.transform);
  const { error } = await context.db.rpc("rpc_save_customer_page_draft", {
    p_offset_x: transform.x,
    p_offset_y: transform.y,
    p_scale: transform.scale,
    p_tagline: input.tagline ?? "",
  });
  if (error) {
    if (error.message?.includes("not_found_or_forbidden")) {
      throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change the customer page.");
    }
    fail("save_customer_page_draft", error);
  }
}

export async function saveCustomerPageArtwork(
  context: AuthenticatedContext,
  mime: string,
  bytes: Buffer,
): Promise<void> {
  const { error } = await context.db.rpc("rpc_save_customer_page_artwork", {
    p_mime: mime,
    p_bytes: `\\x${bytes.toString("hex")}`,
  });
  if (error) {
    if (error.message?.includes("invalid_artwork")) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "That photo is too big or the wrong type.");
    }
    if (error.message?.includes("not_found_or_forbidden")) {
      throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change the customer page.");
    }
    fail("save_customer_page_artwork", error);
  }
}

export async function publishCustomerPage(context: AuthenticatedContext): Promise<void> {
  const { error } = await context.db.rpc("rpc_publish_customer_page");
  if (error) {
    if (error.message?.includes("not_found_or_forbidden")) {
      throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change the customer page.");
    }
    fail("publish_customer_page", error);
  }
}

export async function getCustomerPageArtwork(
  context: AuthenticatedContext,
  side: "draft" | "published",
): Promise<{ mime: string; bytes: Buffer } | null> {
  const { data, error } = await context.db.rpc("rpc_get_customer_page_artwork", {
    p_side: side,
  });
  if (error) {
    if (error.message?.includes("not_found_or_forbidden")) {
      throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change the customer page.");
    }
    fail("get_customer_page_artwork", error);
  }
  const row = firstRow<{ mime: string; bytes: string | Uint8Array }>(data);
  if (!row?.bytes || !row.mime) return null;
  const bytes = typeof row.bytes === "string" ? Buffer.from(row.bytes.replace(/^\\x/i, ""), "hex") : Buffer.from(row.bytes);
  return { mime: row.mime, bytes };
}

export async function getPublicPresentation(token: string): Promise<CustomerPresentation> {
  const tokenHash = digestStandToken(token);
  const previousHash = digestStandTokenWithPreviousKey(token);
  try {
    const { data, error } = await serviceRoleClient().rpc("rpc_public_customer_presentation", {
      p_token_hash: tokenHash,
      p_previous_token_hash: previousHash,
    });
    if (error) {
      logger.warn("customer_page.presentation_unavailable", { error });
      return EMPTY_PRESENTATION;
    }
    const row = firstRow<{
      has_hero: boolean;
      offset_x: number;
      offset_y: number;
      scale: number;
      tagline: string | null;
    }>(data);
    if (!row) return EMPTY_PRESENTATION;
    return presentationFromUnknown(
      {
        offsetX: row.offset_x,
        offsetY: row.offset_y,
        scale: row.scale,
        tagline: row.tagline,
      },
      row.has_hero ? `/api/v1/public/q/${encodeURIComponent(token)}/artwork` : null,
    );
  } catch (error) {
    logger.warn("customer_page.presentation_unavailable", { error });
    return EMPTY_PRESENTATION;
  }
}

export async function getPublicHero(token: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const tokenHash = digestStandToken(token);
  const previousHash = digestStandTokenWithPreviousKey(token);
  const { data, error } = await serviceRoleClient().rpc("rpc_public_customer_hero", {
    p_token_hash: tokenHash,
    p_previous_token_hash: previousHash,
  });
  if (error) fail("public_hero", error);
  const row = firstRow<{ mime: string; bytes: string | Uint8Array }>(data);
  if (!row?.bytes || !row.mime) return null;
  const bytes = typeof row.bytes === "string" ? Buffer.from(row.bytes.replace(/^\\x/i, ""), "hex") : Buffer.from(row.bytes);
  return { mime: row.mime, bytes };
}
