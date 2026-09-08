import "server-only";

import { customerPageEditorEnabled } from "@/lib/server/feature-flags";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import type { AuthenticatedContext } from "@/lib/server/auth";

/**
 * Customer Page V2 owner service.
 *
 * Backend counterpart of `docs/backend/CUSTOMER_PAGE_V2.md`. Owners edit a
 * draft, then publish. The draft never leaks into the public flow; the
 * public flow only ever reads the published snapshot. Every mutation is a
 * SECURITY DEFINER RPC in Postgres (see the 20260907 migrations), so a
 * missing role check in this handler cannot become an authorization bypass:
 * the RPC checks the caller's active membership itself.
 *
 * Photo binaries never travel through this file. The upload flow returns a
 * short-lived signed URL to the private bucket, the client PUTs directly,
 * and finalize runs application-side image validation before promoting the
 * asset to `ready`. The published snapshot references assets by id only.
 */

export const CUSTOMER_PAGE_TEMPLATES = [
  "signature",
  "modern",
  "bold",
  "editorial",
  "classic",
  "minimal",
] as const;

export type CustomerPageTemplate = (typeof CUSTOMER_PAGE_TEMPLATES)[number];

export interface CustomerPageDraft {
  templateId?: CustomerPageTemplate | undefined;
  hero?: {
    assetId?: string | null | undefined;
    focalX?: number | undefined;
    focalY?: number | undefined;
    zoom?: number | undefined;
  } | undefined;
  logo?: {
    assetId?: string | null | undefined;
  } | undefined;
}

export interface CustomerPageProfileView {
  id: string | null;
  scope: "organization" | "location";
  locationId: string | null;
  composerVersion: number;
  draft: CustomerPageDraft;
  draftUpdatedAt: string | null;
  published: CustomerPageDraft | null;
  publishedVersion: number;
  publishedAt: string | null;
}

interface RawProfileRow {
  id: string;
  scope: "organization" | "location";
  location_id: string | null;
  composer_version: number;
  draft: unknown;
  draft_updated_at: string;
  published: unknown;
  published_version: number;
  published_at: string | null;
}

function assertEnabled(): void {
  if (!customerPageEditorEnabled()) {
    // Fail closed by default: the editor and its APIs are gated behind an
    // explicit environment flag so the surface can be shipped dark.
    throw new ApiError(
      404,
      ERROR_CODE.notFound,
      "The customer page editor is not enabled for this deployment.",
    );
  }
}

function fail(context: string, error: unknown, requestId: string): never {
  logger.error("customer_page.database_error", { context, requestId, error });
  throw new ApiError(
    503,
    ERROR_CODE.serviceUnavailable,
    "This service is temporarily unavailable. Please try again shortly.",
  );
}

function rpcMessage(error: unknown): string {
  return (error as { message?: string } | null)?.message ?? "";
}

function rpcCode(error: unknown): string {
  return (error as { code?: string } | null)?.code ?? "";
}

function mapOwnerRpcError(context: string, error: unknown, requestId: string): never {
  const message = rpcMessage(error);
  const code = rpcCode(error);
  if (code === "42501" || /forbidden|authentication required/i.test(message)) {
    throw new ApiError(403, ERROR_CODE.forbidden, "You do not have permission to do that.");
  }
  if (code === "42704" || /location not found|asset_not_found/i.test(message)) {
    throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
  }
  if (/hero_asset_not_ready|logo_asset_not_ready/.test(message)) {
    throw new ApiError(
      400,
      ERROR_CODE.validationFailed,
      "One of the images is not ready. Re-upload and try again.",
    );
  }
  if (/no draft to publish/.test(message)) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "There is nothing to publish yet.");
  }
  if (
    /invalid_template|invalid_draft|invalid_source_path|invalid_variants|unsupported_content_type|invalid_dimensions|invalid_source_hash|no_variants/.test(
      message,
    )
  ) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The draft is not valid.");
  }
  fail(context, error, requestId);
}

function coerceDraft(value: unknown): CustomerPageDraft {
  if (value === null || typeof value !== "object") return {};
  return value as CustomerPageDraft;
}

function projectProfile(row: RawProfileRow | undefined | null, scope: "organization" | "location", locationId: string | null): CustomerPageProfileView {
  if (!row) {
    return {
      id: null,
      scope,
      locationId,
      composerVersion: 1,
      draft: {},
      draftUpdatedAt: null,
      published: null,
      publishedVersion: 0,
      publishedAt: null,
    };
  }
  return {
    id: row.id,
    scope: row.scope,
    locationId: row.location_id,
    composerVersion: row.composer_version,
    draft: coerceDraft(row.draft),
    draftUpdatedAt: row.draft_updated_at,
    published: row.published_version > 0 ? coerceDraft(row.published) : null,
    publishedVersion: row.published_version,
    publishedAt: row.published_at,
  };
}

// -------------------------------------------------------------- reads -----

/**
 * Read the draft + published snapshot for the org default or a location.
 * Never returns another org's data — the RPC verifies membership and RLS
 * denies the underlying table for non-members.
 */
export async function getCustomerPageProfile(
  context: AuthenticatedContext,
  orgId: string,
  locationId: string | null,
  requestId: string,
): Promise<CustomerPageProfileView> {
  assertEnabled();

  const { data, error } = await context.db.rpc("rpc_customer_page_get", {
    p_org_id: orgId,
    p_location_id: locationId,
  });

  if (error) mapOwnerRpcError("get_profile", error, requestId);
  const row = Array.isArray(data) ? (data[0] as RawProfileRow | undefined) : undefined;
  return projectProfile(row, locationId ? "location" : "organization", locationId);
}

// ---------------------------------------------------------- mutations -----

export async function patchCustomerPageDraft(
  context: AuthenticatedContext,
  orgId: string,
  locationId: string | null,
  draft: CustomerPageDraft,
  composerVersion: number,
  requestId: string,
): Promise<CustomerPageProfileView> {
  assertEnabled();

  // Structural check here as well as in the RPC, so validation errors come
  // back as 400 rather than as a database error.
  if (draft.templateId && !CUSTOMER_PAGE_TEMPLATES.includes(draft.templateId)) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "That template is not available.");
  }

  const { error } = await context.db.rpc("rpc_customer_page_patch_draft", {
    p_org_id: orgId,
    p_location_id: locationId,
    p_draft: draft,
    p_composer_version: composerVersion,
  });

  if (error) mapOwnerRpcError("patch_draft", error, requestId);
  return await getCustomerPageProfile(context, orgId, locationId, requestId);
}

export async function publishCustomerPage(
  context: AuthenticatedContext,
  orgId: string,
  locationId: string | null,
  requestId: string,
): Promise<CustomerPageProfileView> {
  assertEnabled();

  const { error } = await context.db.rpc("rpc_customer_page_publish", {
    p_org_id: orgId,
    p_location_id: locationId,
  });

  if (error) mapOwnerRpcError("publish", error, requestId);

  return await getCustomerPageProfile(context, orgId, locationId, requestId);
}

// -------------------------------------------------------------- assets ----

export interface AssetUploadCreation {
  assetId: string;
  /**
   * Placeholder for the signed URL the browser will PUT the source bytes
   * to. The upload target is a private bucket path, minted by the
   * application and never a public URL. When the storage bucket is
   * configured the value here will be a short-lived signed URL; until then
   * this returns null and the client is expected to wait for the upload
   * surface to be enabled.
   */
  uploadUrl: string | null;
  sourceObjectPath: string;
}

/**
 * Reserve an asset id and record where the source bytes will land. The
 * actual signed URL comes from the storage provider (Supabase Storage,
 * S3, R2 …) and is minted outside this file when that is configured. This
 * function is safe to call before storage is wired: the row is created,
 * `uploadUrl` is returned as null, and the client learns immediately that
 * uploads are not yet enabled.
 */
export async function createCustomerPageAssetUpload(
  context: AuthenticatedContext,
  orgId: string,
  locationId: string | null,
  kind: "hero" | "logo",
  contentType: "image/jpeg" | "image/png" | "image/webp",
  requestId: string,
): Promise<AssetUploadCreation> {
  assertEnabled();

  // Path is content-hashed *after* upload; the pre-upload placeholder path
  // is opaque, contains no org name, and is unique per reservation so a
  // replay cannot collide.
  const opaque = crypto.randomUUID().replace(/-/g, "");
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const sourceObjectPath = `customer-page/source/${opaque.slice(0, 2)}/${opaque}.${ext}`;

  const { data, error } = await context.db.rpc("rpc_customer_page_create_asset_upload", {
    p_org_id: orgId,
    p_location_id: locationId,
    p_kind: kind,
    p_source_object_path: sourceObjectPath,
    p_source_content_type: contentType,
  });

  if (error) mapOwnerRpcError("create_asset_upload", error, requestId);
  const assetId = typeof data === "string" ? data : (Array.isArray(data) ? String(data[0]) : "");
  if (!assetId) fail("create_asset_upload", new Error("no asset id"), requestId);

  return { assetId, uploadUrl: null, sourceObjectPath };
}

/**
 * Finalize an asset after out-of-band image processing.
 *
 * The application is responsible for: decoding the image to verify it is
 * really the declared content type, rejecting image bombs and pathological
 * dimensions, stripping EXIF/GPS/metadata, normalizing orientation, and
 * writing responsive derivatives to opaque content-hashed public paths.
 * Only after that does this function move the row to `ready`. The
 * finalize RPC itself is service-role only so a browser cannot forge the
 * numbers.
 */
export async function finalizeCustomerPageAsset(
  orgId: string,
  assetId: string,
  meta: {
    width: number;
    height: number;
    sourceBytes: number;
    sourceSha256: string;
    variants: Array<{
      width: number;
      height: number;
      path: string;
      contentType: string;
      bytes: number;
    }>;
  },
  requestId: string,
): Promise<void> {
  assertEnabled();

  const { error } = await serviceRoleClient().rpc("rpc_customer_page_finalize_asset", {
    p_org_id: orgId,
    p_asset_id: assetId,
    p_width: meta.width,
    p_height: meta.height,
    p_source_bytes: meta.sourceBytes,
    p_source_sha256: meta.sourceSha256,
    p_variants: meta.variants,
  });
  if (error) mapOwnerRpcError("finalize_asset", error, requestId);
}

// ---------------------------------------------- public presentation -------

export interface PublicCustomerPagePresentation {
  publishedVersion: number;
  templateId: CustomerPageTemplate;
  composerVersion: number;
  hero: {
    focalX: number;
    focalY: number;
    zoom: number;
    variants: Array<{ width: number; height: number; url: string }>;
    width: number | null;
    height: number | null;
  } | null;
  logo: {
    variants: Array<{ width: number; height: number; url: string }>;
  } | null;
}

interface PublicResolverRow {
  scope: "organization" | "location";
  published: {
    templateId?: CustomerPageTemplate;
    hero?: { focalX?: number; focalY?: number; zoom?: number };
    logo?: unknown;
  } | null;
  published_version: number;
  hero_variants: Array<{ width: number; height: number; path: string; contentType: string; bytes: number }> | null;
  hero_width: number | null;
  hero_height: number | null;
  logo_variants: Array<{ width: number; height: number; path: string; contentType: string; bytes: number }> | null;
}

/**
 * Resolve the published customer-page presentation for one stand's
 * location. Called from the anonymous public context. Returns `null` when
 * neither the location nor the org has a published profile — in that case
 * the customer page renders the built-in Minimal look.
 *
 * Never returns draft data. Never returns org/location/stand ids. Never
 * returns bucket paths — only the public URLs of published derivatives.
 */
export async function resolvePublicCustomerPage(
  orgId: string,
  locationId: string,
  requestId: string,
): Promise<PublicCustomerPagePresentation | null> {
  const { data, error } = await serviceRoleClient().rpc("rpc_customer_page_resolve_public", {
    p_org_id: orgId,
    p_location_id: locationId,
  });

  if (error) {
    // A resolver failure never blocks the customer's rating flow — falling
    // back to the built-in Minimal look is a strictly better outcome than
    // failing the request outright.
    logger.warn("customer_page.public_resolve_failed", { requestId, error });
    return null;
  }

  const row = Array.isArray(data) ? (data[0] as PublicResolverRow | undefined) : undefined;
  if (!row || !row.published || row.published_version <= 0) return null;

  const templateId = (row.published.templateId ?? "minimal") as CustomerPageTemplate;
  if (!CUSTOMER_PAGE_TEMPLATES.includes(templateId)) return null;

  const heroVariants = Array.isArray(row.hero_variants)
    ? row.hero_variants
        .filter((v) => isSafePublicAssetPath(v.path))
        .map((v) => ({ width: v.width, height: v.height, url: publicAssetUrl(v.path) }))
    : [];
  const logoVariants = Array.isArray(row.logo_variants)
    ? row.logo_variants
        .filter((v) => isSafePublicAssetPath(v.path))
        .map((v) => ({ width: v.width, height: v.height, url: publicAssetUrl(v.path) }))
    : [];

  const heroSpec = row.published.hero ?? {};
  const focalX = clamp(numOr(heroSpec.focalX, 0.5), 0, 1);
  const focalY = clamp(numOr(heroSpec.focalY, 0.5), 0, 1);
  const zoom = clamp(numOr(heroSpec.zoom, 1), 1, 1.5);

  return {
    publishedVersion: row.published_version,
    templateId,
    composerVersion: 1,
    hero: heroVariants.length > 0
      ? {
          focalX,
          focalY,
          zoom,
          variants: heroVariants,
          width: row.hero_width,
          height: row.hero_height,
        }
      : null,
    logo: logoVariants.length > 0 ? { variants: logoVariants } : null,
  };
}

function numOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Turn a private-bucket-relative path into a public URL. When the CDN is
 * configured the value comes from `CUSTOMER_PAGE_PUBLIC_ASSET_BASE`;
 * otherwise the raw path is returned so a template render can degrade to
 * a placeholder rather than a broken URL.
 */
function isSafePublicAssetPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    /^customer-page\/public\/[a-zA-Z0-9._/-]+$/.test(path)
  );
}

function publicAssetUrl(path: string): string {
  const base = process.env.CUSTOMER_PAGE_PUBLIC_ASSET_BASE?.trim();
  if (!base) return path;
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${normalized}${suffix}`;
}
