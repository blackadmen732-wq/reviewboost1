"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CustomerPageBranding } from "@/features/customer-flow/customer-page-branding";
import type { CustomerPageContent } from "@/lib/server/customer-page-service";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface CustomerPageEditorProps {
  businessName: string;
  isPublished: boolean;
  onSaved?: () => void;
}

type UploadState = "idle" | "signing" | "uploading" | "confirming" | "done" | "error";

const SESSION_EXPIRED = "Your session expired. Please sign in again.";

/**
 * Every owner API route requires the caller's bearer token; a cookie alone is
 * rejected with 401. Without this the editor loaded nothing and could not save.
 */
async function ownerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();
  if (!session) throw new Error(SESSION_EXPIRED);

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(path, { ...init, headers });
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return err.error?.message ?? fallback;
}

/**
 * The preview uses the same CustomerPageBranding component that /q/{token}
 * renders, fed the same shape. There is no separate preview renderer.
 *
 * Draft preservation: on mount the editor loads the complete draft from the
 * server and tracks it as a single object. Edits (tagline, hero) are merged
 * into that object before saving, so an edit to one field never silently drops
 * the others (templateId, logoAssetId) that were saved in a previous session.
 */
export function CustomerPageEditor({
  businessName,
  isPublished: initialIsPublished,
  onSaved,
}: CustomerPageEditorProps) {
  // The full draft as returned by GET /api/v1/customer-page.
  // Editing is done by merging changes into this rather than tracking fields
  // separately, so a save never drops a field the owner set in a prior session.
  const [draft, setDraft] = useState<CustomerPageContent>({});
  // heroUrl is display-only: the confirmed public URL for the preview.
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [loaded, setLoaded] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await ownerFetch("/api/v1/customer-page");
        if (!res.ok) {
          setStatusMsg(await errorMessage(res, "Could not load your page. Refresh to try again."));
          return;
        }
        const { data } = (await res.json()) as {
          data: {
            draft: CustomerPageContent;
            published: { heroUrl?: string | null; tagline?: string | null } | null;
          };
        };
        setDraft(data.draft ?? {});
        // Show the published hero URL for the preview (the draft asset URL is
        // not resolved here; only published assets have a public URL).
        if (data.published?.heroUrl) setHeroUrl(data.published.heroUrl);
        setIsPublished(data.published !== null);
      } catch (error) {
        setStatusMsg(error instanceof Error ? error.message : "Could not load your page.");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadHero = useCallback(async (file: File) => {
    setUploadError(null);
    setUploadState("signing");

    try {
      // Step 1: get signed upload ticket
      const beginRes = await ownerFetch("/api/v1/customer-page/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "hero", contentType: file.type }),
      });
      if (!beginRes.ok) {
        const err = await beginRes.json().catch(() => ({}));
        setUploadState("error");
        setUploadError((err as { error?: { message?: string } }).error?.message ?? "Upload failed.");
        return;
      }
      const { data: ticket } = (await beginRes.json()) as {
        data: { assetId: string; path: string; token: string };
      };

      // Step 2: upload directly to Supabase Storage
      setUploadState("uploading");
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const storageUrl = `${supabaseUrl}/storage/v1/object/upload/sign/customer-page/${ticket.path}?token=${ticket.token}`;
      const putRes = await fetch(storageUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "x-upsert": "true" },
        body: file,
      });
      if (!putRes.ok) {
        setUploadState("error");
        setUploadError("Storage upload failed. Please try again.");
        return;
      }

      // Step 3: confirm upload server-side
      setUploadState("confirming");
      const confirmRes = await ownerFetch("/api/v1/customer-page/assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: ticket.assetId, path: ticket.path }),
      });
      if (!confirmRes.ok) {
        const err = await confirmRes.json().catch(() => ({}));
        setUploadState("error");
        setUploadError(
          (err as { error?: { message?: string } }).error?.message ?? "Confirmation failed.",
        );
        return;
      }

      // Show a local preview URL and record the assetId in the draft.
      setHeroUrl(URL.createObjectURL(file));
      setDraft((prev) => ({ ...prev, heroAssetId: ticket.assetId }));
      setUploadState("done");
    } catch (error) {
      setUploadState("error");
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    }
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      void uploadHero(file);
      e.target.value = "";
    },
    [uploadHero],
  );

  const saveDraft = useCallback(async () => {
    setSaving(true);
    setStatusMsg(null);
    // Send the full draft so the RPC replace does not drop fields the owner
    // set in a previous session (templateId, logoAssetId, etc.).
    const body: CustomerPageContent = { ...draft, tagline: draft.tagline ?? null };
    try {
      const res = await ownerFetch("/api/v1/customer-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatusMsg(await errorMessage(res, "Save failed. Try again."));
      } else {
        setStatusMsg("Draft saved.");
        onSaved?.();
      }
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : "Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setStatusMsg(null);
    try {
      // Save the full draft first so the published snapshot captures everything.
      // If that save fails, stop: publishing now would put the previous draft live.
      const saved = await ownerFetch("/api/v1/customer-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, tagline: draft.tagline ?? null }),
      });
      if (!saved.ok) {
        setStatusMsg(await errorMessage(saved, "Save failed. Try again."));
        return;
      }

      const res = await ownerFetch("/api/v1/customer-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setStatusMsg(await errorMessage(res, "Publish failed. Try again."));
      } else {
        setStatusMsg("Page is live!");
        setIsPublished(true);
        onSaved?.();
      }
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : "Publish failed. Try again.");
    } finally {
      setPublishing(false);
    }
  }, [draft, onSaved]);

  const uploading =
    uploadState === "signing" || uploadState === "uploading" || uploadState === "confirming";
  const uploadLabel =
    uploadState === "signing"
      ? "Preparing…"
      : uploadState === "uploading"
        ? "Uploading…"
        : uploadState === "confirming"
          ? "Verifying…"
          : heroUrl
            ? "Replace photo"
            : "Add photo";

  // The preview page shape mirrors CustomerReviewContext["page"] so
  // CustomerPageBranding renders exactly what the customer will receive.
  const previewPage = {
    heroUrl: heroUrl ?? null,
    tagline: draft.tagline ?? null,
    templateId: draft.templateId ?? ("classic" as const),
    logoUrl: null,
  };

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Live preview — uses the real CustomerPageBranding component */}
      <div className="w-full max-w-xs shrink-0 rounded-2xl border border-border bg-[var(--rb-canvas)] p-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Preview
        </p>
        {previewPage.heroUrl || previewPage.tagline ? (
          <CustomerPageBranding page={previewPage} businessName={businessName} />
        ) : (
          <p className="text-sm text-muted">Your cover photo and tagline will appear here.</p>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-1 flex-col gap-4">
        {/* Photo upload */}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#6b635b]">
            Cover photo
          </p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-10 items-center gap-2 rounded-lg border border-[color:var(--rb-border)] bg-white px-4 text-sm font-medium text-[#1a1712] hover:bg-[#faf9f7] disabled:opacity-60"
          >
            {uploading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : null}
            {uploadLabel}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />
          {uploadError && <p className="mt-1 text-xs text-red-600">{uploadError}</p>}
        </div>

        {/* Tagline */}
        <div>
          <label
            htmlFor="tagline"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6b635b]"
          >
            Tagline
          </label>
          <input
            id="tagline"
            type="text"
            maxLength={120}
            value={draft.tagline ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, tagline: e.target.value || null }))}
            placeholder="e.g. Fresh coffee, good vibes"
            className="w-full rounded-lg border border-[color:var(--rb-border)] bg-white px-3 py-2 text-sm text-[#1a1712] placeholder-[#9e968e] focus:outline-none focus:ring-2 focus:ring-[color:var(--rb-ink)]"
          />
          <p className="mt-1 text-right text-[10px] text-[#9e968e]">
            {(draft.tagline ?? "").length}/120
          </p>
        </div>

        {/* Status */}
        {statusMsg && (
          <p
            className={`text-sm ${statusMsg.includes("live") || statusMsg.includes("saved") ? "text-green-700" : "text-red-600"}`}
          >
            {statusMsg}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={saving || uploading}
            onClick={() => void saveDraft()}
            className="flex h-10 items-center rounded-lg border border-[color:var(--rb-border)] bg-white px-4 text-sm font-medium text-[#1a1712] hover:bg-[#faf9f7] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            disabled={publishing || uploading}
            onClick={() => void publish()}
            className="flex h-10 items-center rounded-lg bg-[color:var(--rb-ink)] px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {publishing ? "Publishing…" : isPublished ? "Update live page" : "Go live"}
          </button>
        </div>
      </div>
    </div>
  );
}
