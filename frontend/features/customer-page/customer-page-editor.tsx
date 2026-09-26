"use client";

import { Check, ImageUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { VisitStars } from "@/features/customer-page/visit-stars";
import { ownerFetch } from "@/lib/api/owner-fetch";
import { NormalizePhotoError, normalizePhoto } from "@/lib/images/normalize-photo";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import type { CustomerPageContent } from "@/lib/server/customer-page-service";
import { cn } from "@/lib/utils/cn";

const previewMessages = customerMessages.en;

interface CustomerPageEditorProps {
  businessName: string;
  onSaved?: () => void;
}

type UploadState = "idle" | "preparing" | "signing" | "uploading" | "confirming" | "done" | "error";

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
  // heroUrl is display-only: the confirmed public URL for the preview.
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The photo customers see today, to tell the owner when the preview differs.
  const [liveHeroAssetId, setLiveHeroAssetId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await ownerFetch("/api/v1/customer-page");
        if (!res.ok) return;
        const { data } = (await res.json()) as {
          data: {
            draft: CustomerPageContent;
            published:
              | { heroUrl?: string | null; heroAssetId?: string | null; tagline?: string | null }
              | null;
            draftHeroUrl?: string | null;
          };
        };
        setDraft(data.draft ?? {});
        setLiveHeroAssetId(data.published?.heroAssetId ?? null);
        // The preview shows what Publish will put live: the draft's photo.
        // It used to show the published photo, so an owner who uploaded and
        // came back later saw the old picture and thought the upload was lost.
        const previewUrl = data.draftHeroUrl ?? data.published?.heroUrl ?? null;
        if (previewUrl) setHeroUrl(previewUrl);
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

  /**
   * Upload → preview → Publish, with the preview first.
   *
   * The chosen photo appears in the phone the moment it is picked, from a
   * local object URL, while the three-step upload (sign, send to storage,
   * confirm) runs behind it. It used to appear only after all three finished,
   * so the owner stared at the old photo wondering whether anything happened.
   * If any step fails the previous photo comes back and the error says so —
   * the preview never shows something that is not actually saved.
   */
  const uploadHero = useCallback(
    async (file: File) => {
      setUploadError(null);
      setUploadState("preparing");
      const previous = heroUrl;

      // Upright, JPEG/PNG/WebP and under 5 MB before anything is sent — a
      // camera photo straight off a phone is usually none of those. The
      // preview shows the prepared photo, which is exactly what is uploaded.
      let photo: Awaited<ReturnType<typeof normalizePhoto>>;
      try {
        photo = await normalizePhoto(file);
      } catch (caught) {
        setUploadState("error");
        setUploadError(
          caught instanceof NormalizePhotoError
            ? caught.message
            : "That photo could not be prepared. Try a different one.",
        );
        return;
      }

      setUploadState("signing");
      const local = URL.createObjectURL(photo.blob);
      setHeroUrl(local);

      const fail = (message: string) => {
        URL.revokeObjectURL(local);
        setHeroUrl(previous);
        setUploadState("error");
        setUploadError(message);
      };
      const messageOf = async (res: Response, fallback: string) => {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return err.error?.message ?? fallback;
      };

      try {
        // Step 1: get a signed upload ticket
        const beginRes = await ownerFetch("/api/v1/customer-page/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "hero", contentType: photo.type }),
        });
        if (!beginRes.ok) return fail(await messageOf(beginRes, "Upload failed."));
        const { data: ticket } = (await beginRes.json()) as {
          data: { assetId: string; path: string; token: string };
        };

        // Step 2: upload directly to Supabase Storage (the ticket authorises it)
        setUploadState("uploading");
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const storageUrl = `${supabaseUrl}/storage/v1/object/upload/sign/customer-page/${ticket.path}?token=${ticket.token}`;
        const putRes = await fetch(storageUrl, {
          method: "PUT",
          headers: { "Content-Type": photo.type, "x-upsert": "true" },
          body: photo.blob,
        });
        if (!putRes.ok) return fail("The photo did not upload. Please try again.");

        // Step 3: confirm the upload server-side
        setUploadState("confirming");
        const confirmRes = await ownerFetch("/api/v1/customer-page/assets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId: ticket.assetId, path: ticket.path }),
        });
        if (!confirmRes.ok) return fail(await messageOf(confirmRes, "The photo could not be checked. Please try again."));

        setDraft((prev) => ({ ...prev, heroAssetId: ticket.assetId }));
        setUploadState("done");
      } catch (caught) {
        fail(
          caught instanceof Error && caught.name === "SessionExpiredError"
            ? caught.message
            : "Could not reach ReviewBoost. Check your connection and try again.",
        );
      }
    },
    [heroUrl],
  );

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
      const saved = await ownerFetch("/api/v1/customer-page", {
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

      const res = await ownerFetch("/api/v1/customer-page", {
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
      setLiveHeroAssetId(draft.heroAssetId ?? null);
      onSaved?.();
    } catch {
      setStatusMsg("Could not reach ReviewBoost. Check your connection and try again.");
    } finally {
      setPublishing(false);
    }
  }, [draft, onSaved]);

  const uploading =
    uploadState === "preparing" ||
    uploadState === "signing" ||
    uploadState === "uploading" ||
    uploadState === "confirming";
  const uploadLabel =
    uploadState === "preparing" || uploadState === "signing"
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

  const unpublished = Boolean(draft.heroAssetId) && draft.heroAssetId !== liveHeroAssetId;
  const published = statusMsg === "Page is live!";

  // Upload → preview → Publish, in that order, in one column. The phone is
  // the owner's preview only; /q/{token} never draws it.
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5">
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={uploading}
          loading={uploading}
          loadingLabel={uploadLabel}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageUp className="size-5" aria-hidden="true" />
          {uploadLabel}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        {uploadError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {uploadError}
          </p>
        ) : null}
      </div>

      <div>
        {unpublished ? (
          <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink">
            <span aria-hidden="true" className="size-2 rounded-full bg-star" />
            Not published yet
          </p>
        ) : null}
        {/* The real customer page — the same CustomerVisitView /q renders —
            with the draft image, inside the preview phone. */}
        <PhoneFrame label={`${businessName} customer page preview`}>
          <CustomerVisitView
            heroUrl={heroUrl ?? null}
            transform={DEFAULT_HERO_TRANSFORM}
            heading={previewMessages.ratingHeading}
            // The live page always says this line; a leftover draft tagline
            // would show here and never reach a customer.
            support={previewMessages.ratingSupport}
            footerLine={previewMessages.footerPromise}
          >
            {/* Inert: this is a picture of the page, not a place to rate. */}
            <VisitStars value={null} messages={previewMessages} preview />
          </CustomerVisitView>
        </PhoneFrame>
      </div>

      {/* One action. publish() saves the draft first, so there is no separate
          Save step to hold in mind. */}
      <div>
        <Button
          type="button"
          variant="action"
          size="lg"
          disabled={publishing || uploading}
          loading={publishing}
          loadingLabel="Publishing…"
          onClick={() => void publish()}
        >
          Publish
        </Button>
        {statusMsg ? (
          <p
            role={published ? "status" : "alert"}
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 text-sm font-medium",
              published ? "text-brand-text" : "text-danger",
            )}
          >
            {published ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : null}
            {statusMsg}
          </p>
        ) : null}
      </div>
    </div>
  );
}
