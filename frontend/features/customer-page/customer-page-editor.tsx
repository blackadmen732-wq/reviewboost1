"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { VisitStars } from "@/features/customer-page/visit-stars";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import type { CustomerPageContent } from "@/lib/server/customer-page-service";

const previewMessages = customerMessages.en;

interface CustomerPageEditorProps {
  businessName: string;
  isPublished: boolean;
  onSaved?: () => void;
}

type UploadState = "idle" | "signing" | "uploading" | "confirming" | "done" | "error";

/**
 * The preview is the customer page itself — the same CustomerVisitView tree
 * that /q/{token} renders, inside phone chrome. Not a summary of it, and not a
 * second renderer that can drift: if the owner sees it here, that is what the
 * customer gets.
 *
 * The hero crop is DEFAULT_HERO_TRANSFORM on both sides. The Customer Page
 * contract stores no per-owner transform, so offering drag/pinch controls here
 * would be a control over nothing — the customer would still receive this crop.
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

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/customer-page");
        if (!res.ok) return;
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
      } catch {
        // ignore — defaults are fine
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadHero = useCallback(async (file: File) => {
    setUploadError(null);
    setUploadState("signing");

    // Step 1: get signed upload ticket
    const beginRes = await fetch("/api/v1/customer-page/assets", {
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
    const confirmRes = await fetch("/api/v1/customer-page/assets", {
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
    const res = await fetch("/api/v1/customer-page", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatusMsg(
        (err as { error?: { message?: string } }).error?.message ?? "Save failed. Try again.",
      );
    } else {
      setStatusMsg("Draft saved.");
      onSaved?.();
    }
  }, [draft, onSaved]);

  /**
   * Publish is save-then-publish, and the save has to succeed.
   *
   * The save result used to be discarded. Publish snapshots whatever draft the
   * server currently holds, so a failed save — expired session, validation,
   * dropped connection — meant publishing the *previous* draft and then telling
   * the owner "Page is live!". They would walk away believing the photo they
   * just picked was on the counter. Stop at the first failure and say which
   * step failed.
   */
  const publish = useCallback(async () => {
    setPublishing(true);
    setStatusMsg(null);

    try {
      const saved = await fetch("/api/v1/customer-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, tagline: draft.tagline ?? null }),
      });

      if (!saved.ok) {
        const err = await saved.json().catch(() => ({}));
        setStatusMsg(
          (err as { error?: { message?: string } }).error?.message ??
            "Could not save your changes, so nothing was published. Try again.",
        );
        return;
      }

      const res = await fetch("/api/v1/customer-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStatusMsg(
          (err as { error?: { message?: string } }).error?.message ?? "Publish failed. Try again.",
        );
        return;
      }

      setStatusMsg("Page is live!");
      setIsPublished(true);
      onSaved?.();
    } catch {
      setStatusMsg("Could not reach ReviewBoost. Check your connection and try again.");
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
      {/* Live preview — the real customer page, in phone chrome. */}
      <div className="w-full shrink-0 lg:max-w-sm">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
          What your customers see
        </p>
        <PhoneFrame label={`${businessName} customer page preview`}>
          <CustomerVisitView
            heroUrl={heroUrl ?? null}
            transform={DEFAULT_HERO_TRANSFORM}
            heading={previewMessages.ratingHeading}
            support={draft.tagline ?? previewMessages.ratingSupport}
            footerLine={previewMessages.footerPromise}
          >
            {/* Inert: this is a picture of the page, not a place to rate. */}
            <VisitStars value={null} messages={previewMessages} preview />
          </CustomerVisitView>
        </PhoneFrame>
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
