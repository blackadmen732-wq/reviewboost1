import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * The owner's Customer Page.
 *
 * Every call names the organization explicitly. Choosing a business from the
 * caller's first membership is how an owner of two shops redesigns the wrong
 * one and only finds out from a customer, so the organization comes from the
 * request's selected organization and the database re-checks it.
 *
 * Draft and published are two different things all the way down: this module
 * writes drafts, and only `publish` moves one to where customers can see it.
 */

export const PAGE_TEMPLATES = ["classic", "bold", "minimal"] as const;
export type PageTemplate = (typeof PAGE_TEMPLATES)[number];

export const ASSET_KINDS = ["logo", "hero"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Matches the database check constraint exactly. */
export const ASSET_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AssetContentType = (typeof ASSET_CONTENT_TYPES)[number];

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_TAGLINE_LENGTH = 120;

export const CUSTOMER_PAGE_BUCKET = "customer-page";

export interface CustomerPageContent {
  templateId?: PageTemplate | undefined;
  tagline?: string | null | undefined;
  logoAssetId?: string | null | undefined;
  heroAssetId?: string | null | undefined;
}

export interface CustomerPageState {
  draft: CustomerPageContent;
  published: (CustomerPageContent & { logoUrl?: string | null; heroUrl?: string | null }) | null;
  /**
   * The draft's photo, so the owner previews what Publish will put live —
   * not the photo that is live now. Null when the draft has none, or its
   * upload never finished.
   */
  draftHeroUrl: string | null;
  publishedVersion: number;
  publishedAt: string | null;
}

function failure(context: string, error: unknown, requestId: string): never {
  logger.error("customer_page.database_error", { context, requestId, error });
  throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}

/** Turn the database's own refusals into something an owner can act on. */
function pageApiError(message: string | undefined): ApiError | null {
  if (!message) return null;
  if (message.includes("not_found_or_forbidden")) {
    return new ApiError(403, ERROR_CODE.forbidden, "You cannot change this page.");
  }
  if (message.includes("asset_not_ready")) {
    return new ApiError(
      409,
      ERROR_CODE.validationFailed,
      "An image is still uploading. Wait for it to finish, then publish.",
    );
  }
  if (message.includes("invalid_page_template")) {
    return new ApiError(400, ERROR_CODE.validationFailed, "That look is not available.");
  }
  if (message.includes("invalid_page_tagline")) {
    return new ApiError(
      400,
      ERROR_CODE.validationFailed,
      `Keep the line to ${MAX_TAGLINE_LENGTH} characters or fewer.`,
    );
  }
  if (message.includes("unknown_page_field")) {
    return new ApiError(400, ERROR_CODE.validationFailed, "That field is not part of a page.");
  }
  return null;
}

function scopeFilter(locationId: string | null) {
  return locationId === null
    ? { scope: "organization" as const, location_id: null }
    : { scope: "location" as const, location_id: locationId };
}

export async function readCustomerPage(
  context: AuthenticatedContext,
  orgId: string,
  locationId: string | null,
  requestId: string,
): Promise<CustomerPageState> {
  const filter = scopeFilter(locationId);
  let query = context.db
    .from("customer_page_profiles")
    .select("draft, published, published_version, published_at")
    .eq("org_id", orgId)
    .eq("scope", filter.scope);

  query = locationId === null ? query.is("location_id", null) : query.eq("location_id", locationId);

  const { data, error } = await query.maybeSingle();
  if (error) failure("read", error, requestId);

  if (!data) {
    // No row yet is not an error: a business that has never opened the editor
    // has an empty draft and nothing published.
    return { draft: {}, published: null, draftHeroUrl: null, publishedVersion: 0, publishedAt: null };
  }

  const row = data as {
    draft: CustomerPageContent;
    published: CustomerPageState["published"];
    published_version: number;
    published_at: string | null;
  };

  const draft = row.draft ?? {};

  // Read as the caller, so RLS keeps this to their own organization's assets;
  // `ready` is the same bar publish uses, so the preview never shows a photo
  // that Publish would then refuse.
  let draftHeroUrl: string | null = null;
  if (draft.heroAssetId) {
    const { data: asset, error: assetError } = await context.db
      .from("customer_page_assets")
      .select("public_url")
      .eq("id", draft.heroAssetId)
      .eq("org_id", orgId)
      .eq("status", "ready")
      .maybeSingle();
    if (assetError) failure("read_draft_asset", assetError, requestId);
    draftHeroUrl = (asset as { public_url?: string | null } | null)?.public_url ?? null;
  }

  return {
    draft,
    published: row.published ?? null,
    draftHeroUrl,
    publishedVersion: row.published_version,
    publishedAt: row.published_at,
  };
}

export async function saveCustomerPageDraft(
  context: AuthenticatedContext,
  orgId: string,
  locationId: string | null,
  draft: CustomerPageContent,
  requestId: string,
): Promise<void> {
  const { error } = await context.db.rpc("rpc_customer_page_save_draft", {
    p_org_id: orgId,
    p_location_id: locationId,
    p_draft: draft,
  });

  if (error) {
    const mapped = pageApiError(error.message);
    if (mapped) throw mapped;
    failure("save_draft", error, requestId);
  }
}

export async function publishCustomerPage(
  context: AuthenticatedContext,
  orgId: string,
  locationId: string | null,
  requestId: string,
): Promise<{ publishedVersion: number }> {
  const { data, error } = await context.db.rpc("rpc_customer_page_publish", {
    p_org_id: orgId,
    p_location_id: locationId,
  });

  if (error) {
    const mapped = pageApiError(error.message);
    if (mapped) throw mapped;
    failure("publish", error, requestId);
  }

  return { publishedVersion: typeof data === "number" ? data : 0 };
}

export async function unpublishCustomerPage(
  context: AuthenticatedContext,
  orgId: string,
  locationId: string | null,
  requestId: string,
): Promise<void> {
  const { error } = await context.db.rpc("rpc_customer_page_unpublish", {
    p_org_id: orgId,
    p_location_id: locationId,
  });

  if (error) {
    const mapped = pageApiError(error.message);
    if (mapped) throw mapped;
    failure("unpublish", error, requestId);
  }
}

// ------------------------------------------------------------- uploads -----

function assetExtension(contentType: AssetContentType): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
  }
}

export interface UploadTicket {
  assetId: string;
  path: string;
  token: string;
}

/**
 * Start an upload.
 *
 * The asset row is created `pending` and the browser is handed a signed URL
 * scoped to one path it does not choose. The path is built from the
 * organization id and a fresh asset id, so one business cannot write into
 * another's prefix by naming a file.
 *
 * Nothing is publishable until `confirmAssetUpload` has seen the object
 * actually exist. A browser saying "I uploaded it" is not evidence.
 */
export async function beginAssetUpload(
  context: AuthenticatedContext,
  orgId: string,
  kind: AssetKind,
  contentType: AssetContentType,
  requestId: string,
): Promise<UploadTicket> {
  const assetId = crypto.randomUUID();
  const path = `org/${orgId}/${kind}/${assetId}.${assetExtension(contentType)}`;

  const { data, error } = await context.db.rpc("rpc_customer_page_asset_begin", {
    p_org_id: orgId,
    p_kind: kind,
    p_storage_path: path,
    p_content_type: contentType,
  });

  if (error) {
    const mapped = pageApiError(error.message);
    if (mapped) throw mapped;
    failure("asset_begin", error, requestId);
  }

  const storage = serviceRoleClient().storage.from(CUSTOMER_PAGE_BUCKET);
  const signed = await storage.createSignedUploadUrl(path);

  if (signed.error || !signed.data) {
    failure("asset_signed_url", signed.error, requestId);
  }

  return {
    assetId: typeof data === "string" ? data : String(data),
    path,
    token: signed.data.token,
  };
}

/**
 * Confirm an upload by looking at storage, not at the caller's word.
 *
 * The object has to exist, be within the size limit, and carry an image
 * content type. Only then does the asset become publishable.
 */
export async function confirmAssetUpload(
  context: AuthenticatedContext,
  orgId: string,
  assetId: string,
  path: string,
  requestId: string,
): Promise<{ publicUrl: string; byteSize: number }> {
  const storage = serviceRoleClient().storage.from(CUSTOMER_PAGE_BUCKET);

  const directory = path.slice(0, path.lastIndexOf("/"));
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const listed = await storage.list(directory, { search: filename, limit: 1 });

  if (listed.error) failure("asset_list", listed.error, requestId);

  const object = listed.data?.find((entry) => entry.name === filename);
  if (!object) {
    throw new ApiError(
      409,
      ERROR_CODE.validationFailed,
      "That image did not finish uploading. Try again.",
    );
  }

  const byteSize = Number(object.metadata?.["size"] ?? 0);
  const objectType = String(object.metadata?.["mimetype"] ?? "");

  if (byteSize <= 0 || byteSize > MAX_ASSET_BYTES) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "Images must be under 5 MB.");
  }
  if (!(ASSET_CONTENT_TYPES as readonly string[]).includes(objectType)) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "Use a PNG, JPEG, or WebP image.");
  }

  const publicUrl = storage.getPublicUrl(path).data.publicUrl;

  const { error } = await serviceRoleClient().rpc("rpc_customer_page_asset_confirm", {
    p_asset_id: assetId,
    p_org_id: orgId,
    p_public_url: publicUrl,
    p_byte_size: byteSize,
  });

  if (error) {
    const mapped = pageApiError(error.message);
    if (mapped) throw mapped;
    failure("asset_confirm", error, requestId);
  }

  void context;
  return { publicUrl, byteSize };
}
