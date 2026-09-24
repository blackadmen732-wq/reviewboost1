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
  onSaved,
}: CustomerPageEditorProps) {
  // The full draft as returned by GET /api/v1/customer-page.
  // Editing is done by merging changes into this rather than tracking fields
  // separately, so a save never drops a field the owner set in a prior session.
  const [draft, setDraft] = useState<CustomerPageContent>({});
  // heroUrl is display-only: whatever image is currently shown in the preview.
  // It is NOT proof that the image is safe to publish — see heroConfirmed.
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  // heroConfirmed tracks whether the image currently in heroUrl has finished
  // server-side confirmation (or is the already-published image loaded on
  // mount). It goes false the instant a new file is picked and only becomes
  // true again once that specific upload is confirmed. Publish reads this,
  // not uploadState, because the failure state must keep blocking Publish
  // even after `uploading` becomes false.
  const [heroConfirmed, setHeroConfirmed] = useState(true);
  const [loaded, setLoaded] = useState(false);
  // The active blob: URL for the local file preview, so it can be revoked
  // when replaced or on unmount instead of leaking.
  const localPreviewUrlRef = useRef<string | null>(null);

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
      } catch {
        // ignore — defaults are fine
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadHero = useCallback(async (file: File) => {
    setUploadError(null);
    setUploadState("signing");

    // Show the picked file immediately — the owner should see their photo in
    // the preview the instant they choose it, not after the upload pipeline
    // finishes. But this image is NOT yet safe to publish: heroConfirmed goes
    // false here and only flips back to true once this exact upload is
    // confirmed server-side below. Publish reads heroConfirmed, so it stays
    // disabled for the entire signing/uploading/confirming/error window, even
    // though the preview already shows the new photo.
    const previousLocalUrl = localPreviewUrlRef.current;
    const localUrl = URL.createObjectURL(file);
    localPreviewUrlRef.current = localUrl;
    setHeroUrl(localUrl);
    setHeroConfirmed(false);
    // Revoke the previous local blob now that nothing references it — the
    // preview element has already re-rendered onto the new URL above.
    if (previousLocalUrl) URL.revokeObjectURL(previousLocalUrl);

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

    // Record the confirmed assetId in the draft. The preview URL was already
    // set to the local file the moment it was chosen, above. Only now is it
    // safe to let Publish go through with this image.
    setDraft((prev) => ({ ...prev, heroAssetId: ticket.assetId }));
    setUploadState("done");
    setHeroConfirmed(true);
  }, []);

  // Revoke the last local blob URL on unmount so it isn't leaked.
  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    };
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
            : "Upload photo";

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Loading…
      </div>
    );
  }

  return (
    <div className="customer-page-editor">
      {/* Controls — left rail on desktop, below the preview on mobile. */}
      <div className="customer-page-editor__rail flex flex-col gap-4">
        {/* Photo upload */}
        <div>
          <p className="rb-section-label mb-2">Cover photo</p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-4 text-sm font-medium text-ink shadow-[var(--shadow-control)] transition-colors hover:border-[color:var(--rb-border-strong)] hover:bg-quiet disabled:opacity-60"
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
          {uploadError && (
            <p className="mt-2 text-xs font-medium text-danger">
              Upload failed — this image has not been saved. {uploadError} The photo shown below
              is only on your screen; pick a photo again or retry before publishing.
            </p>
          )}
        </div>

        {/* The tagline input lived here. V1 is deliberately upload → preview →
            Publish, so the control is gone; `tagline` stays in the draft, the
            payload and the renderer, so nothing an owner already wrote is lost
            and restoring the field is putting this input back. */}

        {/* Status */}
        {statusMsg && (
          <p
            className={`text-sm font-medium ${statusMsg.includes("live") || statusMsg.includes("saved") ? "text-brand-text" : "text-danger"}`}
          >
            {statusMsg}
          </p>
        )}

        {/* One action. "Save draft" beside "Go live" asked the owner to hold a
            draft/published model in their head to decide which button meant
            "done"; publish() saves first regardless, so the draft step was
            already implicit. The safety underneath is unchanged. */}
        <div>
          <button
            type="button"
            disabled={publishing || uploading || !heroConfirmed}
            onClick={() => void publish()}
            className="flex min-h-12 w-full items-center justify-center rounded-[var(--radius-control)] border border-action bg-action px-5 text-[0.9375rem] font-semibold text-on-action shadow-[var(--shadow-button)] transition-[background-color,box-shadow] duration-150 hover:border-action-hover hover:bg-action-hover hover:shadow-[var(--shadow-button-hover)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100 sm:w-auto"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>

      {/* Live preview — the real customer page, in phone chrome. Large stage
          on desktop; stacked above the rail on mobile. */}
      <div className="customer-page-editor__stage">
        <p className="rb-section-label mb-3">What your customers see</p>
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
    </div>
  );
}
