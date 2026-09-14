"use client";

import { ImagePlus, Save, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { notify } from "@/components/ui/toast";
import { CustomerPageView } from "@/features/customer-page/customer-page-view";
import { useHeroGestures } from "@/features/customer-page/use-hero-gestures";
import { type HeroTransform } from "@/lib/owner/hero-transform";
import { supabaseBrowser } from "@/lib/supabase/browser";

export interface CustomerPageEditorModel {
  draft: HeroTransform;
  draftTagline: string | null;
  hasDraftHero: boolean;
  hasPublishedHero: boolean;
  publishedAt: string | null;
  draftArtworkUrl: string;
}

type UploadStatus = "idle" | "uploading" | "confirmed" | "failed";

export function CustomerPageEditor({
  initial,
  businessName,
}: {
  initial: CustomerPageEditorModel;
  businessName: string;
}) {
  const [transform, setTransform] = useState<HeroTransform>(initial.draft);
  const [tagline, setTagline] = useState(initial.draftTagline ?? "");

  const serverUrl = initial.hasDraftHero
    ? `${initial.draftArtworkUrl}&t=${initial.publishedAt ?? "draft"}`
    : null;
  const [confirmedServerUrl, setConfirmedServerUrl] = useState<string | null>(serverUrl);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>(
    initial.hasDraftHero ? "confirmed" : "idle",
  );

  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [live, setLive] = useState(Boolean(initial.hasPublishedHero && initial.publishedAt));
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gestures = useHeroGestures(transform, setTransform);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  const displayUrl = localPreviewUrl ?? confirmedServerUrl;
  const hasConfirmedArtwork = confirmedServerUrl !== null && uploadStatus !== "uploading";
  const canPublish = hasConfirmedArtwork && busy === null;

  const authHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    if (!session) {
      notify.error("Please sign in again", "Your session expired.");
      return null;
    }
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  async function onFile(file: File) {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    const local = URL.createObjectURL(file);
    setLocalPreviewUrl(local);
    setUploadStatus("uploading");
    setError(null);

    const headers = await authHeaders();
    if (!headers) {
      setUploadStatus("failed");
      setError("Please sign in again to upload.");
      return;
    }

    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/v1/customer-page/artwork", {
        method: "POST",
        headers,
        body,
      });
      if (!response.ok) throw new Error("upload");
      const newServerUrl = `${initial.draftArtworkUrl}&t=${Date.now()}`;
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("artwork-verify"));
        img.src = newServerUrl;
      });
      URL.revokeObjectURL(local);
      setLocalPreviewUrl(null);
      setConfirmedServerUrl(newServerUrl);
      setUploadStatus("confirmed");
      notify.success("Photo added", "Move it until it looks right, then publish.");
    } catch {
      URL.revokeObjectURL(local);
      setLocalPreviewUrl(null);
      setUploadStatus(confirmedServerUrl ? "failed" : "idle");
      setError(
        confirmedServerUrl
          ? "Could not add that photo. Your previous photo is still saved."
          : "Could not add that photo. Use a JPG or PNG under 2 MB.",
      );
    }
  }

  async function saveDraft() {
    const headers = await authHeaders();
    if (!headers) return;
    setBusy("save");
    setError(null);
    try {
      const response = await fetch("/api/v1/customer-page", {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          transform,
          tagline: tagline.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error("save");
      notify.success("Draft saved");
    } catch {
      setError("Could not save. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!canPublish) return;
    const headers = await authHeaders();
    if (!headers) return;
    setBusy("publish");
    setError(null);
    try {
      const response = await fetch("/api/v1/customer-page", {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          transform,
          tagline: tagline.trim() || undefined,
          publish: true,
        }),
      });
      if (!response.ok) throw new Error("publish");
      setLive(true);
      notify.success("Published", "Tags now open this page.");
    } catch {
      setError("Could not publish. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
      {/* Phone preview */}
      <div>
        <p className="mb-3 text-sm font-medium text-muted">
          {live ? "Live on your tags" : "Not published yet"}
        </p>
        <div className="mx-auto w-full max-w-[280px] lg:max-w-[320px]">
          <CustomerPageView
            businessName={businessName}
            heroUrl={displayUrl}
            transform={transform}
            tagline={tagline || null}
            onPointerDown={displayUrl ? gestures.onPointerDown : undefined}
            onPointerMove={displayUrl ? gestures.onPointerMove : undefined}
            onPointerUp={displayUrl ? gestures.onPointerUp : undefined}
            onWheel={displayUrl ? gestures.onWheel : undefined}
          />
        </div>
      </div>

      {/* Controls rail */}
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Your photo</h2>
        <p className="mt-1 text-sm text-muted">
          {displayUrl ? "Drag to reposition. Scroll to zoom." : "Add a photo of your business."}
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Choose a photo"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
            event.target.value = "";
          }}
        />

        <div className="mt-5 flex flex-col gap-3">
          <Button
            variant="primary"
            size="default"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null || uploadStatus === "uploading"}
            loading={uploadStatus === "uploading"}
            loadingLabel="Uploading..."
          >
            <ImagePlus className="size-5" aria-hidden="true" />
            {uploadStatus === "failed" ? "Try another photo" : displayUrl ? "Replace photo" : "Add photo"}
          </Button>

          {/* Tagline */}
          <div>
            <label htmlFor="cp-tagline" className="mb-1.5 block text-sm font-medium text-ink">
              Tagline
              <span className="ml-1 text-xs font-normal text-muted">(optional, {80 - tagline.length} left)</span>
            </label>
            <input
              id="cp-tagline"
              type="text"
              maxLength={80}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Family-owned since 1985"
              className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-4 focus:ring-[color:var(--rb-focus-soft)]"
            />
          </div>

          <div className="border-t border-border pt-3">
            <Button
              variant="secondary"
              size="default"
              onClick={() => void saveDraft()}
              disabled={busy !== null || uploadStatus === "uploading"}
              loading={busy === "save"}
              loadingLabel="Saving..."
            >
              <Save className="size-5" aria-hidden="true" />
              Save draft
            </Button>
          </div>

          <Button
            variant="primary"
            size="default"
            onClick={() => void publish()}
            disabled={!canPublish}
            loading={busy === "publish"}
            loadingLabel="Publishing..."
          >
            <Upload className="size-5" aria-hidden="true" />
            Publish
          </Button>
        </div>

        {uploadStatus === "failed" ? (
          <div className="mt-3">
            <InlineNotice kind="error" blocking>
              {error ?? "Upload failed. Please try again with a different photo."}
            </InlineNotice>
          </div>
        ) : error ? (
          <div className="mt-3">
            <InlineNotice kind="error" blocking>{error}</InlineNotice>
          </div>
        ) : null}
      </div>
    </div>
  );
}
