"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_HERO_TRANSFORM, type HeroTransform } from "@/lib/owner/hero-transform";
import { useHeroGestures } from "./use-hero-gestures";
import { CustomerPageView } from "./customer-page-view";

interface CustomerPageEditorProps {
  businessName: string;
  initialTagline: string | null;
  initialHeroUrl: string | null;
  initialTransform?: HeroTransform;
  isPublished: boolean;
  onSaved?: () => void;
}

type UploadState = "idle" | "signing" | "uploading" | "confirming" | "done" | "error";

export function CustomerPageEditor({
  businessName,
  initialTagline,
  initialHeroUrl,
  initialTransform,
  isPublished: initialIsPublished,
  onSaved,
}: CustomerPageEditorProps) {
  const [tagline, setTagline] = useState(initialTagline ?? "");
  const [heroUrl, setHeroUrl] = useState(initialHeroUrl);
  const [heroAssetId, setHeroAssetId] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [transform, setTransform] = useState<HeroTransform>(
    initialTransform ?? DEFAULT_HERO_TRANSFORM,
  );

  // Load current state from the API on mount so the editor reflects reality
  // even when the server component passed empty defaults.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/customer-page");
        if (!res.ok) return;
        const { data } = (await res.json()) as {
          data: {
            draft: { tagline?: string | null; heroAssetId?: string | null };
            published: { heroUrl?: string | null } | null;
          };
        };
        if (data.draft.tagline != null) setTagline(data.draft.tagline);
        if (data.draft.heroAssetId) setHeroAssetId(data.draft.heroAssetId);
        if (data.published?.heroUrl) setHeroUrl(data.published.heroUrl);
        setIsPublished(data.published !== null);
      } catch {
        // ignore — stale defaults are fine
      }
    })();
  }, []);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { onPointerDown, onPointerMove, onPointerUp, onWheel } = useHeroGestures(
    transform,
    setTransform,
  );

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

    // Show preview from object URL while backend processes
    setHeroUrl(URL.createObjectURL(file));
    setHeroAssetId(ticket.assetId);
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
    const body: Record<string, unknown> = { tagline: tagline || null };
    if (heroAssetId) body.heroAssetId = heroAssetId;
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
  }, [tagline, heroAssetId, onSaved]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setStatusMsg(null);
    // Save draft first to capture any unsaved tagline/hero changes
    const saveBody: Record<string, unknown> = { tagline: tagline || null };
    if (heroAssetId) saveBody.heroAssetId = heroAssetId;
    await fetch("/api/v1/customer-page", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saveBody),
    });

    const res = await fetch("/api/v1/customer-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setPublishing(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatusMsg(
        (err as { error?: { message?: string } }).error?.message ?? "Publish failed. Try again.",
      );
    } else {
      setStatusMsg("Page is live!");
      setIsPublished(true);
      onSaved?.();
    }
  }, [tagline, heroAssetId, onSaved]);

  const uploading =
    uploadState === "signing" || uploadState === "uploading" || uploadState === "confirming";
  const uploadLabel = uploadState === "signing"
    ? "Preparing…"
    : uploadState === "uploading"
      ? "Uploading…"
      : uploadState === "confirming"
        ? "Verifying…"
        : "Add photo";

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Live preview */}
      <div className="w-full max-w-[220px] shrink-0 self-center lg:self-start">
        <CustomerPageView
          businessName={businessName}
          heroUrl={heroUrl}
          transform={transform}
          tagline={tagline || null}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        />
        {heroUrl && (
          <p className="mt-2 text-center text-[11px] text-[#6b635b]">
            Drag to reposition · scroll to zoom
          </p>
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
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Fresh coffee, good vibes"
            className="w-full rounded-lg border border-[color:var(--rb-border)] bg-white px-3 py-2 text-sm text-[#1a1712] placeholder-[#9e968e] focus:outline-none focus:ring-2 focus:ring-[color:var(--rb-ink)]"
          />
          <p className="mt-1 text-right text-[10px] text-[#9e968e]">{tagline.length}/120</p>
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
