"use client";

import { Download, ImagePlus, Save, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { notify } from "@/components/ui/toast";
import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { downloadBlankCustomerTemplate } from "@/features/customer-page/blank-template";
import { useHeroGestures } from "@/features/customer-page/use-hero-gestures";
import { type HeroTransform, heroTransformStyle, clampHeroTransform } from "@/lib/owner/hero-transform";
import { CUSTOMER_CANVAS } from "@/lib/owner/customer-canvas";
import { supabaseBrowser } from "@/lib/supabase/browser";

export interface CustomerPageEditorModel {
  draft: HeroTransform;
  draftTagline: string | null;
  hasDraftHero: boolean;
  hasPublishedHero: boolean;
  publishedAt: string | null;
  draftArtworkUrl: string;
}

export function CustomerPageEditor({
  initial,
  businessName,
}: {
  initial: CustomerPageEditorModel;
  businessName: string;
}) {
  const [transform, setTransform] = useState<HeroTransform>(initial.draft);
  const [tagline, setTagline] = useState(initial.draftTagline ?? "");
  const [heroUrl, setHeroUrl] = useState<string | null>(
    initial.hasDraftHero
      ? `${initial.draftArtworkUrl}&t=${initial.publishedAt ?? "draft"}`
      : null,
  );
  const [busy, setBusy] = useState<"upload" | "save" | "publish" | null>(null);
  const [live, setLive] = useState(Boolean(initial.hasPublishedHero && initial.publishedAt));
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gestures = useHeroGestures(transform, setTransform);

  useEffect(() => {
    return () => {
      if (heroUrl?.startsWith("blob:")) URL.revokeObjectURL(heroUrl);
    };
  }, [heroUrl]);

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
    const local = URL.createObjectURL(file);
    setHeroUrl(local);
    setError(null);

    const headers = await authHeaders();
    if (!headers) return;
    setBusy("upload");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/v1/customer-page/artwork", {
        method: "POST",
        headers,
        body,
      });
      if (!response.ok) throw new Error("upload");
      notify.success("Photo added", "Move it until it looks right, then publish.");
    } catch {
      setError("Could not add that photo. Use a JPG or PNG under 2 MB.");
    } finally {
      setBusy(null);
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

  const crop = clampHeroTransform(transform);

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
      {/* Phone preview */}
      <div>
        <p className="mb-3 text-sm font-medium text-muted">
          {live ? "Live on your tags" : "Not published yet"}
        </p>
        <div className="mx-auto w-full max-w-[280px] lg:max-w-[320px]">
          <div
            className="overflow-hidden rounded-[28px] border-[6px] border-[color:var(--rb-ink)] bg-[#100c09] shadow-lg"
            style={{ aspectRatio: CUSTOMER_CANVAS.aspectRatio }}
          >
            {/* Hero section */}
            <div
              className="relative overflow-hidden"
              style={{
                height: `${CUSTOMER_CANVAS.heroShare * 100}%`,
                background: heroUrl
                  ? undefined
                  : "linear-gradient(166deg, #3b3128 0%, #251d17 48%, #16110d 100%)",
                cursor: heroUrl ? "grab" : undefined,
                touchAction: heroUrl ? "none" : undefined,
              }}
              onPointerDown={heroUrl ? gestures.onPointerDown : undefined}
              onPointerMove={heroUrl ? gestures.onPointerMove : undefined}
              onPointerUp={heroUrl ? gestures.onPointerUp : undefined}
              onPointerCancel={heroUrl ? gestures.onPointerUp : undefined}
              onWheel={heroUrl ? gestures.onWheel : undefined}
            >
              {heroUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroUrl}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  style={{ transform: heroTransformStyle(crop) }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/40">
                  No photo yet
                </div>
              )}
              {/* Scrim for business identity */}
              {heroUrl ? (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(to bottom, rgb(14 10 8 / 62%) 0%, rgb(14 10 8 / 40%) 24%, rgb(14 10 8 / 14%) 44%, rgb(14 10 8 / 0%) 62%)",
                  }}
                />
              ) : null}
              {/* Business identity */}
              <div className="pointer-events-none relative mt-auto px-4 pb-3 pt-8 text-center text-white drop-shadow-lg">
                <p className="text-lg font-bold leading-tight">{businessName}</p>
                {tagline ? (
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80">
                    {tagline}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Rating card */}
            <div
              className="flex flex-col items-center rounded-t-[20px] bg-white px-4 pb-4 pt-5 text-center"
              style={{
                height: `${CUSTOMER_CANVAS.cardShare * 100}%`,
                marginTop: "-20px",
                position: "relative",
                zIndex: 1,
              }}
            >
              <h2 className="text-lg font-extrabold leading-tight tracking-tight text-[#1a1712]">
                How was your visit?
              </h2>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6b635b]">
                Tap a star to let us know
              </p>
              {/* Preview stars */}
              <div className="mt-4 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <svg
                    key={n}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#8f8579"
                    strokeWidth={1.25}
                    className="h-8 w-8"
                    aria-hidden="true"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ))}
              </div>
              <div className="mt-auto">
                <ReviewBoostLogo pose="poweredBy" size="poweredBy" className="text-[#6b635b]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Controls rail */}
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Your photo</h2>
        <p className="mt-1 text-sm text-muted">
          {heroUrl ? "Drag to reposition. Scroll to zoom." : "Add a photo of your business."}
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
            disabled={busy !== null}
            loading={busy === "upload"}
            loadingLabel="Uploading..."
          >
            <ImagePlus className="size-5" aria-hidden="true" />
            {heroUrl ? "Replace photo" : "Add photo"}
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

          {/* Logo placeholder */}
          <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-quiet p-3">
            <p className="text-sm font-medium text-muted">Logo upload</p>
            <p className="mt-0.5 text-xs text-faint">
              Coming soon. The backend contract for logo persistence is not yet available.
            </p>
          </div>

          <div className="border-t border-border pt-3">
            <Button
              variant="secondary"
              size="default"
              onClick={() => void saveDraft()}
              disabled={busy !== null}
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
            disabled={busy !== null || !heroUrl}
            loading={busy === "publish"}
            loadingLabel="Publishing..."
          >
            <Upload className="size-5" aria-hidden="true" />
            Publish
          </Button>

          <Button
            variant="secondary"
            size="default"
            onClick={() => downloadBlankCustomerTemplate()}
            disabled={busy !== null}
          >
            <Download className="size-5" aria-hidden="true" />
            Download blank template
          </Button>
        </div>

        {error ? (
          <div className="mt-3">
            <InlineNotice kind="error" blocking>{error}</InlineNotice>
          </div>
        ) : null}
      </div>
    </div>
  );
}
