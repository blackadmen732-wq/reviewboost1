"use client";

import { Check, ImageUp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { VisitStars } from "@/features/customer-page/visit-stars";
import Link from "next/link";

import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";
import { withWriteDeadline } from "@/lib/api/read-deadline";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";
import {
  NormalizePhotoError,
  normalizePhoto,
} from "@/lib/images/normalize-photo";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import type {
  CustomerPageContent,
  CustomerPageState,
} from "@/lib/server/customer-page-service";

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
  const [draft, setDraft] = useState<CustomerPageContent>({});
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [publishedDraft, setPublishedDraft] =
    useState<CustomerPageContent | null>(null);
  const [publishedVersion, setPublishedVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [publishState, setPublishState] = useState<
    "idle" | "publishing" | "published" | "error"
  >("idle");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(true);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [pendingPublication, setPendingPublication] = useState(false);
  const publishIntent = useRef<{
    content: CustomerPageContent;
    version: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await readPage(controller.signal);
        if (controller.signal.aborted) return;
        setDraft(data.draft ?? {});
        setPublishedDraft(data.published ?? null);
        setPublishedVersion(data.publishedVersion ?? 0);
        setHeroUrl(draftPhotoUrl(data));
      } catch (caught) {
        if (!controller.signal.aborted)
          setLoadError(
            caught instanceof SessionExpiredError
              ? caught.message
              : "Could not load your customer page. Your published page has not changed.",
          );
      } finally {
        if (!controller.signal.aborted) setLoaded(true);
      }
    })();
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(
    () => () => {
      if (heroUrl?.startsWith("blob:")) URL.revokeObjectURL(heroUrl);
    },
    [heroUrl],
  );

  // Leaving while a photo uploads or a save is unconfirmed would lose it.
  // The browser's own "Leave site?" prompt is the honest warning here.
  const unsettled =
    !draftSaved ||
    draftSaving ||
    ["preparing", "signing", "uploading", "confirming"].includes(uploadState) ||
    publishState === "publishing";
  useEffect(() => {
    if (!unsettled) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsettled]);

  /** PUT is idempotent content replacement. Check an uncertain response before retry. */
  const saveDraft = useCallback(
    async (content: CustomerPageContent): Promise<boolean> => {
      setDraftSaving(true);
      setDraftSaved(false);
      setDraftSaveError(null);
      try {
        const response = await ownerFetch("/api/v1/customer-page", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(content),
        });
        if (!response.ok)
          throw new Error(
            await responseMessage(response, "Could not save your photo."),
          );
        if (mounted.current) setDraftSaved(true);
        return true;
      } catch (caught) {
        try {
          const state = await readPage();
          if (editableContent(state.draft) === editableContent(content)) {
            if (mounted.current) setDraftSaved(true);
            return true;
          }
        } catch {
          /* Preserve the local intent. The live page is unchanged. */
        }
        if (mounted.current)
          setDraftSaveError(
            caught instanceof SessionExpiredError
              ? caught.message
              : "Could not confirm your saved photo. Keep this page open and try saving again. Your published page has not changed.",
          );
        return false;
      } finally {
        if (mounted.current) setDraftSaving(false);
      }
    },
    [],
  );

  /** A confirmed asset must become a saved draft before upload reports completion. */
  const uploadHero = useCallback(
    async (file: File) => {
      if (operation.current) return;
      operation.current = true;
      setUploadError(null);
      setDraftSaveError(null);
      setStatusMsg(null);
      setPublishState("idle");
      setUploadState("preparing");
      const previous = heroUrl;
      try {
        let photo: Awaited<ReturnType<typeof normalizePhoto>>;
        try {
          photo = await normalizePhoto(file);
        } catch (caught) {
          if (mounted.current) {
            setUploadState("error");
            setUploadError(
              caught instanceof NormalizePhotoError
                ? caught.message
                : "That photo could not be prepared. Try a different one.",
            );
          }
          return;
        }
        if (!mounted.current) return;
        setUploadState("signing");
        setHeroUrl(URL.createObjectURL(photo.blob));
        const fail = (message: string) => {
          if (!mounted.current) return;
          setHeroUrl(previous);
          setUploadState("error");
          setUploadError(message);
        };
        try {
          const begin = await ownerFetch("/api/v1/customer-page/assets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "hero", contentType: photo.type }),
          });
          if (!begin.ok)
            return fail(await responseMessage(begin, "Upload failed."));
          const { data: ticket } = (await begin.json()) as {
            data: { assetId: string; path: string; token: string };
          };
          if (!mounted.current) return;
          setUploadState("uploading");
          const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/customer-page/${ticket.path}?token=${ticket.token}`;
          const sent = await withWriteDeadline(
            async (signal) =>
              await fetch(url, {
                signal,
                method: "PUT",
                headers: { "Content-Type": photo.type, "x-upsert": "true" },
                body: photo.blob,
              }),
          );
          if (!sent.ok)
            return fail("The photo did not upload. Please try again.");
          if (!mounted.current) return;
          setUploadState("confirming");
          const confirmed = await ownerFetch("/api/v1/customer-page/assets", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assetId: ticket.assetId,
              path: ticket.path,
            }),
          });
          if (!confirmed.ok)
            return fail(
              await responseMessage(
                confirmed,
                "The photo could not be checked. Please try again.",
              ),
            );
          const { data } = (await confirmed.json()) as {
            data?: { publicUrl?: string };
          };
          if (!data?.publicUrl)
            return fail("The photo could not be checked. Try again.");
          if (!mounted.current) return;
          setHeroUrl(data.publicUrl);
          const next = { ...draft, heroAssetId: ticket.assetId };
          setDraft(next);
          await saveDraft(next);
          if (mounted.current) setUploadState("done");
        } catch (caught) {
          fail(
            caught instanceof SessionExpiredError
              ? caught.message
              : "Could not reach ReviewBoost. Check your connection and try again.",
          );
        }
      } finally {
        operation.current = false;
      }
    },
    [draft, heroUrl, saveDraft],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void uploadHero(file);
      event.target.value = "";
    },
    [uploadHero],
  );

  const removePhoto = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    setUploadError(null);
    setStatusMsg(null);
    setPublishState("idle");
    const next = { ...draft, heroAssetId: null };
    setDraft(next);
    setHeroUrl(null);
    try {
      await saveDraft(next);
    } finally {
      operation.current = false;
    }
  }, [draft, saveDraft]);

  const confirmPublished = useCallback(
    (content: CustomerPageContent, version: number) => {
      if (!mounted.current) return;
      setPublishedDraft({ ...content });
      setPublishedVersion(version);
      setPublishState("published");
      setPendingPublication(false);
      setStatusMsg(null);
      publishIntent.current = null;
      onSaved?.();
    },
    [onSaved],
  );

  /** A lost publish response is reconciled with a read, never automatically replayed. */
  const checkPublication = useCallback(
    async (failure?: string) => {
      const intent = publishIntent.current;
      if (!intent) return;
      setPublishState("publishing");
      try {
        const state = await readPage();
        if (
          state.published &&
          state.publishedVersion > intent.version &&
          editableContent(state.published) === editableContent(intent.content)
        ) {
          confirmPublished(intent.content, state.publishedVersion);
          return;
        }
        if (!mounted.current) return;
        setPublishedDraft(state.published);
        setPublishedVersion(state.publishedVersion);
        setPendingPublication(false);
        publishIntent.current = null;
        setStatusMsg(
          `${failure ? `${failure} ` : ""}Your published page still shows the earlier version. Your draft is saved; you can try Publish again.`,
        );
      } catch (caught) {
        if (mounted.current)
          setStatusMsg(
            caught instanceof SessionExpiredError
              ? caught.message
              : "We could not confirm whether publishing finished. Check the published page before trying again.",
          );
      } finally {
        if (mounted.current)
          setPublishState((state) =>
            state === "publishing" ? "error" : state,
          );
      }
    },
    [confirmPublished],
  );

  const publish = useCallback(async () => {
    if (operation.current || pendingPublication || !draftSaved) return;
    operation.current = true;
    setPublishState("publishing");
    setStatusMsg(null);
    try {
      const saved = await ownerFetch("/api/v1/customer-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, tagline: draft.tagline ?? null }),
      });
      if (!saved.ok) {
        setStatusMsg(
          await responseMessage(
            saved,
            "Could not save your changes, so nothing was published. Try again.",
          ),
        );
        return;
      }
      publishIntent.current = { content: draft, version: publishedVersion };
      const response = await ownerFetch("/api/v1/customer-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const message = await responseMessage(
          response,
          "Could not confirm publishing.",
        );
        if (response.status < 500) {
          publishIntent.current = null;
          setStatusMsg(message);
          return;
        }
        setPendingPublication(true);
        await checkPublication(message);
        return;
      }
      const { data } = (await response.json()) as {
        data?: { publishedVersion?: number };
      };
      confirmPublished(draft, data?.publishedVersion ?? publishedVersion);
    } catch (caught) {
      if (publishIntent.current) {
        setPendingPublication(true);
        await checkPublication("Could not reach ReviewBoost.");
      } else if (mounted.current)
        setStatusMsg(
          caught instanceof SessionExpiredError
            ? caught.message
            : "Could not reach ReviewBoost. Check your connection and try again.",
        );
    } finally {
      operation.current = false;
      if (mounted.current)
        setPublishState((state) => (state === "publishing" ? "error" : state));
    }
  }, [
    draft,
    draftSaved,
    pendingPublication,
    publishedVersion,
    checkPublication,
    confirmPublished,
  ]);

  const uploading = [
    "preparing",
    "signing",
    "uploading",
    "confirming",
  ].includes(uploadState);
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
  const published =
    unchanged &&
    !uploading &&
    draftSaved &&
    !draftSaving &&
    !pendingPublication;

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
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-auto flex-1 px-3 font-medium shadow-none"
            disabled={
              uploading || publishing || draftSaving || pendingPublication
            }
            loading={uploading}
            loadingLabel={uploadLabel}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageUp className="size-4" aria-hidden="true" />
            {uploadLabel}
          </Button>
          {heroUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-auto flex-1 px-3"
              disabled={
                uploading || publishing || draftSaving || pendingPublication
              }
              onClick={() => void removePhoto()}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remove photo
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Without a photo, the top stays white.
        </p>
        {draftSaving ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Saving your photo…
          </p>
        ) : draftSaveError ? (
          <div className="mt-3">
            <p role="alert" className="text-sm text-danger">
              {draftSaveError}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => void saveDraft(draft)}
            >
              Save photo again
            </Button>
          </div>
        ) : !unchanged && draftSaved && uploadState === "done" ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Photo saved. Publish when you’re ready.
          </p>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={
            uploading || publishing || draftSaving || pendingPublication
          }
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
            disabled={
              publishing ||
              uploading ||
              draftSaving ||
              !draftSaved ||
              pendingPublication ||
              published
            }
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
            {uploading || draftSaving
              ? "Your photo is being saved."
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
          <div className="mt-4">
            <p role="alert" className="text-sm text-danger">
              {statusMsg}
            </p>
            {pendingPublication ? (
              <Button
                variant="secondary"
                className="mt-3"
                loading={publishing}
                loadingLabel="Checking…"
                onClick={() => void checkPublication()}
              >
                Check published page
              </Button>
            ) : null}
          </div>
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

async function responseMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? fallback;
}
async function readPage(signal?: AbortSignal): Promise<CustomerPageState> {
  const response = await ownerFetch(
    "/api/v1/customer-page",
    signal ? { signal } : {},
  );
  if (!response.ok) throw new Error("Could not read your customer page.");
  const { data } = (await response.json()) as { data: CustomerPageState };
  return { ...data, publishedVersion: data.publishedVersion ?? 0 };
}
/** Current null is intentional. Fallback is only for a legacy omitted URL. */
function draftPhotoUrl(state: {
  draft: CustomerPageContent;
  draftHeroUrl?: string | null;
  published: (CustomerPageContent & { heroUrl?: string | null }) | null;
}): string | null {
  if (state.draftHeroUrl !== undefined) return state.draftHeroUrl;
  if (state.draft?.heroAssetId === null) return null;
  return state.published &&
    state.draft?.heroAssetId === state.published.heroAssetId
    ? (state.published.heroUrl ?? null)
    : null;
}
