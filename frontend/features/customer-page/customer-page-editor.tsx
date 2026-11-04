"use client";

import { Check, ImageUp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { OutcomeCheckNotice } from "@/components/ui/outcome-check-notice";
import { RetryNotice } from "@/components/ui/retry-notice";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { EditorSkeleton } from "@/features/customer-page/editor-skeleton";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { VisitStars } from "@/features/customer-page/visit-stars";
import Link from "next/link";

import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";
import { OWNER_WRITE_TIMEOUT_MS } from "@/lib/api/read-deadline";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";
import {
  UploadStalledError,
  uploadWithProgress,
} from "@/lib/images/upload-with-progress";
import { checkOutcome } from "@/lib/recovery/check-outcome";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";
import { useOutcomeCheck } from "@/lib/recovery/use-outcome-check";
import {
  NormalizePhotoError,
  SOFT_LONG_EDGE,
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
  /** How much of the photo has gone up, 0 to 1, while uploading. */
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** A quiet word about a photo that worked but will look soft. Never blocks. */
  const [photoNote, setPhotoNote] = useState<string | null>(null);
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
  /** Stops the photo going up: the owner's "Stop upload", or leaving. */
  const uploadStop = useRef<AbortController | null>(null);
  const [uploadStopped, setUploadStopped] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Nothing would confirm it once the editor is gone: stop sending it.
      uploadStop.current?.abort();
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
        if (caught instanceof SessionExpiredError) {
          if (mounted.current) setDraftSaveError(caught.message);
          return false;
        }
        // The answer was lost. Read the draft back rather than send it again
        // (a write is never replayed by itself): it says whether it is saved.
        const outcome = await checkOutcome(
          async (signal) =>
            editableContent((await readPage(signal)).draft) ===
            editableContent(content),
        ).catch((expired: unknown) => expired);
        if (outcome === "done") {
          if (mounted.current) setDraftSaved(true);
          return true;
        }
        if (mounted.current)
          setDraftSaveError(
            outcome instanceof SessionExpiredError
              ? outcome.message
              : outcome === "not-done"
                ? "Your photo didn’t save. It’s still here. Save it again."
                : "No answer from ReviewBoost yet. Your photo is still here. Save it again.",
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
      setUploadStopped(false);
      setPhotoNote(null);
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
          setUploadProgress(0);
          setUploadState("uploading");
          const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/customer-page/${ticket.path}?token=${ticket.token}`;
          // A photo may take as long as it keeps moving: on a weak signal it
          // can need more than the 30 s a change gets, and still arrive. It
          // gives up after 30 s with no progress, or when the owner stops it.
          const stop = new AbortController();
          uploadStop.current = stop;
          let sent: { ok: boolean; status: number };
          try {
            sent = await uploadWithProgress(url, photo.blob, {
              signal: stop.signal,
              stallMs: OWNER_WRITE_TIMEOUT_MS,
              headers: { "Content-Type": photo.type, "x-upsert": "true" },
              onProgress: (fraction) => {
                if (mounted.current) setUploadProgress(fraction);
              },
            });
          } catch (caught) {
            if (!stop.signal.aborted) throw caught;
            // Stopped on purpose, so not a failure: the page keeps its photo.
            if (!mounted.current) return;
            setHeroUrl(previous);
            setUploadState("idle");
            setUploadStopped(true);
            return;
          } finally {
            uploadStop.current = null;
          }
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
          setPhotoNote(
            Math.max(photo.width, photo.height) < SOFT_LONG_EDGE
              ? "This photo is small, so it may look soft on larger phones. A bigger one will look sharper."
              : null,
          );
          const next = { ...draft, heroAssetId: ticket.assetId };
          setDraft(next);
          await saveDraft(next);
          if (mounted.current) setUploadState("done");
        } catch (caught) {
          fail(
            caught instanceof SessionExpiredError
              ? caught.message
              : caught instanceof UploadStalledError
                ? "The photo stopped uploading. Check your connection and try again."
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
    setUploadStopped(false);
    setPhotoNote(null);
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

  /** The page as the last check read it, so a "not published" can show what is. */
  const lastRead = useRef<CustomerPageState | null>(null);
  /** What the server said, when it answered with an error. */
  const publishFailure = useRef<string | null>(null);
  const publishCheck = useOutcomeCheck({
    onDone: () => {
      const intent = publishIntent.current;
      const state = lastRead.current;
      if (intent && state) confirmPublished(intent.content, state.publishedVersion);
    },
    onNotDone: () => {
      const state = lastRead.current;
      if (!mounted.current) return;
      if (state) {
        setPublishedDraft(state.published);
        setPublishedVersion(state.publishedVersion);
      }
      setPendingPublication(false);
      publishIntent.current = null;
      const failure = publishFailure.current;
      setStatusMsg(
        `${failure ? `${failure} ` : ""}Your page wasn’t published. Your draft is saved. Publish again.`,
      );
    },
    onExpired: (message) => {
      if (!mounted.current) return;
      setPendingPublication(false);
      publishIntent.current = null;
      setStatusMsg(message);
    },
  });

  /**
   * A lost publish answer is settled by reading the page, never by
   * publishing again: the read says whether the new version went live.
   */
  const startPublishCheck = publishCheck.start;
  const checkPublication = useCallback((failure?: string) => {
    if (!publishIntent.current) return;
    publishFailure.current = failure ?? null;
    setPendingPublication(true);
    setStatusMsg(null);
    startPublishCheck(async (signal) => {
      const intent = publishIntent.current;
      const state = await readPage(signal);
      lastRead.current = state;
      return Boolean(
        intent &&
          state.published &&
          state.publishedVersion > intent.version &&
          editableContent(state.published) === editableContent(intent.content),
      );
    }, failure ? { serverAnswered: true } : undefined);
  }, [startPublishCheck]);

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
        checkPublication(message);
        return;
      }
      const { data } = (await response.json()) as {
        data?: { publishedVersion?: number };
      };
      confirmPublished(draft, data?.publishedVersion ?? publishedVersion);
    } catch (caught) {
      if (publishIntent.current) {
        checkPublication();
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
        ? `Uploading… ${Math.round(uploadProgress * 100)}%`
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

  if (!loaded) return <EditorSkeleton />;
  const reload = () => {
    setLoaded(false);
    setLoadError(null);
    setLoadAttempt((attempt) => attempt + 1);
  };
  if (loadError && !loadError.includes("session expired")) {
    return <EditorLoadFailed failure={loadAttempt} onRetry={reload} />;
  }
  if (loadError) {
    return (
      <div className="max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
        <Button className="mt-4" variant="secondary" onClick={reload}>
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
        {uploadState === "uploading" ? (
          <div className="mt-2 flex items-center gap-2">
            <div
              role="progressbar"
              aria-label="Photo upload"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(uploadProgress * 100)}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-quiet"
              data-upload-progress
            >
              <div
                className="h-full rounded-full bg-action transition-[width] duration-200 motion-reduce:transition-none"
                style={{ width: `${Math.round(uploadProgress * 100)}%` }}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-auto px-3"
              onClick={() => uploadStop.current?.abort()}
            >
              Stop upload
            </Button>
          </div>
        ) : null}
        {uploadStopped ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Upload stopped. Your page hasn’t changed.
          </p>
        ) : null}
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Your storefront, your team or your best dish. Upright photos fill
          the top of the page best. Without a photo, the top stays white.
        </p>
        {photoNote ? (
          <p className="mt-2 text-sm leading-relaxed text-ink" data-photo-note>
            {photoNote}
          </p>
        ) : null}
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
              "Publish page"
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
        ) : publishCheck.pending ? (
          <OutcomeCheckNotice check={publishCheck} className="mt-4" />
        ) : statusMsg ? (
          <div className="mt-4">
            <p role="alert" className="text-sm text-danger">
              {statusMsg}
            </p>
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
            preview
            heroUrl={heroUrl}
            transform={DEFAULT_HERO_TRANSFORM}
            businessName={businessName}
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

/**
 * The editor could not load. It tries again by itself (3 s, 10 s, 30 s, or
 * when the connection is back). Only loading failed: the published page is
 * whatever it was.
 */
function EditorLoadFailed({
  failure,
  onRetry,
}: {
  failure: number;
  onRetry: () => void;
}) {
  const retry = useAutoRetry({ key: "customer-page-editor", failure, onRetry });
  return (
    <div className="max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <RetryNotice
        retry={retry}
        what="Your customer page didn’t load."
      />
    </div>
  );
}
