"use client";

import { Check, ImageUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { VisitStars } from "@/features/customer-page/visit-stars";
import Link from "next/link";

import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";
import {
  NormalizePhotoError,
  normalizePhoto,
} from "@/lib/images/normalize-photo";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import type { CustomerPageContent } from "@/lib/server/customer-page-service";

const previewMessages = customerMessages.en;

interface CustomerPageEditorProps {
  businessName: string;
  onSaved?: () => void;
  previewStandId?: string | null;
}

type UploadState =
  | "idle"
  | "preparing"
  | "signing"
  | "uploading"
  | "confirming"
  | "done"
  | "error";

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
  previewStandId = null,
}: CustomerPageEditorProps) {
  // The full draft as returned by GET /api/v1/customer-page.
  // Editing is done by merging changes into this rather than tracking fields
  // separately, so a save never drops a field the owner set in a prior session.
  const [draft, setDraft] = useState<CustomerPageContent>({});
  // heroUrl is display-only: the confirmed public URL for the preview.
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The photo customers see today, to tell the owner when the preview differs.
  const [publishedDraft, setPublishedDraft] =
    useState<CustomerPageContent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [publishState, setPublishState] = useState<
    "idle" | "publishing" | "published" | "error"
  >("idle");

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const res = await ownerFetch("/api/v1/customer-page");
        if (!res.ok) throw new Error("load_failed");
        const { data } = (await res.json()) as {
          data: {
            draft: CustomerPageContent;
            published:
              (CustomerPageContent & { heroUrl?: string | null }) | null;
            draftHeroUrl?: string | null;
          };
        };
        if (!current) return;
        setDraft(data.draft ?? {});
        setPublishedDraft(data.published ?? null);
        setHeroUrl(data.draftHeroUrl ?? data.published?.heroUrl ?? null);
      } catch (caught) {
        if (current)
          setLoadError(
            caught instanceof SessionExpiredError
              ? caught.message
              : "Could not load your customer page. Your published page has not changed.",
          );
      } finally {
        if (current) setLoaded(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [loadAttempt]);

  useEffect(
    () => () => {
      if (heroUrl?.startsWith("blob:")) URL.revokeObjectURL(heroUrl);
    },
    [heroUrl],
  );

  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
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
      setStatusMsg(null);
      setPublishState("idle");
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
        const err = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        return err.error?.message ?? fallback;
      };

      try {
        // Step 1: get a signed upload ticket
        const beginRes = await ownerFetch("/api/v1/customer-page/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "hero", contentType: photo.type }),
        });
        if (!beginRes.ok)
          return fail(await messageOf(beginRes, "Upload failed."));
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
        if (!putRes.ok)
          return fail("The photo did not upload. Please try again.");

        // Step 3: confirm the upload server-side
        setUploadState("confirming");
        const confirmRes = await ownerFetch("/api/v1/customer-page/assets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId: ticket.assetId, path: ticket.path }),
        });
        if (!confirmRes.ok)
          return fail(
            await messageOf(
              confirmRes,
              "The photo could not be checked. Please try again.",
            ),
          );

        const confirmed = (await confirmRes.json()) as {
          data?: { publicUrl?: string };
        };
        if (confirmed.data?.publicUrl) setHeroUrl(confirmed.data.publicUrl);
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
    setPublishState("publishing");
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
          (err as { error?: { message?: string } }).error?.message ??
            "Publish failed. Try again.",
        );
        return;
      }

      setPublishState("published");
      setPublishedDraft({ ...draft });
      onSaved?.();
    } catch {
      setStatusMsg(
        "Could not reach ReviewBoost. Check your connection and try again.",
      );
    } finally {
      setPublishState((state) => (state === "publishing" ? "error" : state));
    }
  }, [draft, onSaved]);

  const uploading =
    uploadState === "preparing" ||
    uploadState === "signing" ||
    uploadState === "uploading" ||
    uploadState === "confirming";
  const uploadLabel =
    uploadState === "preparing" || uploadState === "signing"
      ? "Preparing photo…"
      : uploadState === "uploading"
        ? "Uploading…"
        : uploadState === "confirming"
          ? "Almost done…"
          : heroUrl
            ? "Replace photo"
            : "Add photo";

  const publishing = publishState === "publishing";
  const unchanged =
    publishedDraft !== null &&
    editableContent(draft) === editableContent(publishedDraft);
  const published = unchanged && !uploading;

  if (!loaded) {
    return (
      <p role="status" className="py-8 text-sm text-muted">
        Loading your customer page…
      </p>
    );
  }
  if (loadError) {
    return (
      <div className="max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => {
            setLoaded(false);
            setLoadError(null);
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Try again
        </Button>
        {loadError.includes("session expired") ? (
          <Link
            href="/login?next=/customer-page"
            className="mt-3 block text-sm text-brand-text underline"
          >
            Sign in again
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:gap-8 lg:pb-0"
      data-customer-page-editor
    >
      <div className="lg:pt-8">
        <h2 className="hidden text-lg font-semibold text-ink lg:block">
          Make it yours
        </h2>
        <p className="mb-4 hidden max-w-[28ch] text-sm leading-relaxed text-muted lg:block">
          Add your business photo. Check the preview, then publish it to your
          Tags.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="font-medium shadow-none"
          disabled={uploading || publishing}
          loading={uploading}
          loadingLabel={uploadLabel}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageUp className="size-4" aria-hidden="true" />
          {uploadLabel}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={uploading || publishing}
          onChange={handleFileChange}
        />
        {uploadError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {uploadError}
          </p>
        ) : null}

        <div
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-canvas px-5 py-3 lg:static lg:mt-6 lg:border-0 lg:p-0"
          data-editor-publish
        >
          <Button
            type="button"
            variant="action"
            disabled={publishing || uploading || published}
            loading={publishing}
            loadingLabel="Publishing…"
            onClick={() => void publish()}
          >
            {published ? (
              <>
                <Check className="size-4" aria-hidden="true" />
                Published
              </>
            ) : (
              "Publish"
            )}
          </Button>
          <p className="mt-2 text-center text-xs text-muted lg:text-left">
            {uploading
              ? "Your photo is uploading."
              : published
                ? "Your Tags use this page."
                : "Changes reach your Tags when you publish."}
          </p>
        </div>

        {published ? (
          <div
            role="status"
            className="mt-5 border-l-2 border-action pl-4"
            data-publish-confirmation
          >
            <p className="text-sm font-semibold text-ink">
              Customer page published
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              This is the page your Tags will show.
            </p>
            {previewStandId ? (
              <PreviewCustomerPage standId={previewStandId} />
            ) : (
              <Link
                href="/stands"
                className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline-offset-4 hover:underline"
              >
                Go to your Tags
              </Link>
            )}
          </div>
        ) : statusMsg ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {statusMsg}
          </p>
        ) : null}
      </div>

      <figure className="min-w-0">
        <figcaption className="mb-3 text-center text-xs font-medium text-muted">
          {published ? "Published page" : "Preview · not published yet"}
        </figcaption>
        <PhoneFrame
          label={`${businessName} customer page preview`}
          size="editor"
        >
          <CustomerVisitView
            heroUrl={heroUrl}
            transform={DEFAULT_HERO_TRANSFORM}
            heading={previewMessages.ratingHeading}
            support={previewMessages.ratingSupport}
            footerLine={previewMessages.footerPromise}
          >
            <VisitStars value={null} messages={previewMessages} preview />
          </CustomerVisitView>
        </PhoneFrame>
      </figure>
    </div>
  );
}

/** Compare saved content, excluding public URLs and publication metadata. */
function editableContent(content: CustomerPageContent): string {
  return JSON.stringify([
    content.templateId ?? null,
    content.logoAssetId ?? null,
    content.heroAssetId ?? null,
    content.tagline ?? null,
  ]);
}
