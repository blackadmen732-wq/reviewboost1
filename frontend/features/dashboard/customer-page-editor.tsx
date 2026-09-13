"use client";

import { Camera, Check, Eye, ImagePlus, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface CustomerPageEditorProps {
  businessName: string;
}

interface Draft {
  hero?: {
    assetId?: string | null;
    focalX?: number;
    focalY?: number;
    zoom?: number;
  };
  logo?: {
    assetId?: string | null;
  };
}

interface Profile {
  id: string | null;
  composerVersion: number;
  draft: Draft;
  published: Draft | null;
  publishedVersion: number;
  publishedAt: string | null;
}

type EditorState = "loading" | "ready" | "saving" | "publishing" | "error";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();
  return session?.access_token ?? null;
}

export function CustomerPageEditor({ businessName }: CustomerPageEditorProps) {
  const [state, setState] = useState<EditorState>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [focalX, setFocalX] = useState(0.5);
  const [focalY, setFocalY] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const hasHero = profile?.draft?.hero?.assetId != null;
  const hasLogo = profile?.draft?.logo?.assetId != null;
  const isPublished = (profile?.publishedVersion ?? 0) > 0;

  const loadProfile = useCallback(async () => {
    setState("loading");
    const token = await getAccessToken();
    if (!token) {
      setState("error");
      return;
    }

    try {
      const res = await fetch("/api/v1/customer-page", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
      });

      if (res.status === 404) {
        setProfile({
          id: null,
          composerVersion: 1,
          draft: {},
          published: null,
          publishedVersion: 0,
          publishedAt: null,
        });
        setState("ready");
        return;
      }

      if (!res.ok) throw new Error("load_failed");
      const json = await res.json();
      const data = json.data ?? json;
      setProfile(data);
      setFocalX(data.draft?.hero?.focalX ?? 0.5);
      setFocalY(data.draft?.hero?.focalY ?? 0.5);
      setZoom(data.draft?.hero?.zoom ?? 1);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const saveDraft = useCallback(async () => {
    setState("saving");
    const token = await getAccessToken();
    if (!token) {
      setState("ready");
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    try {
      const res = await fetch("/api/v1/customer-page", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          composerVersion: 1,
          draft: {
            hero: {
              ...(profile?.draft?.hero ?? {}),
              focalX,
              focalY,
              zoom,
            },
            logo: profile?.draft?.logo ?? {},
          },
        }),
      });

      if (!res.ok) throw new Error("save_failed");
      const json = await res.json();
      setProfile(json.data ?? json);
      setDirty(false);
      setState("ready");
      notify.success("Draft saved", "Your changes are saved but not yet live.");
    } catch {
      setState("ready");
      notify.error("Could not save", "Please try again.");
    }
  }, [profile, focalX, focalY, zoom]);

  const publish = useCallback(async () => {
    setState("publishing");
    const token = await getAccessToken();
    if (!token) {
      setState("ready");
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    if (dirty) {
      const saveRes = await fetch("/api/v1/customer-page", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          composerVersion: 1,
          draft: {
            hero: {
              ...(profile?.draft?.hero ?? {}),
              focalX,
              focalY,
              zoom,
            },
            logo: profile?.draft?.logo ?? {},
          },
        }),
      });
      if (!saveRes.ok) {
        setState("ready");
        notify.error("Could not save", "Please try again.");
        return;
      }
    }

    try {
      const res = await fetch("/api/v1/customer-page/publish", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      if (!res.ok) throw new Error("publish_failed");
      const json = await res.json();
      setProfile(json.data ?? json);
      setDirty(false);
      setState("ready");
      notify.success("Published", "Customers now see your updated page.");
    } catch {
      setState("ready");
      notify.error("Could not publish", "Please try again.");
    }
  }, [profile, focalX, focalY, zoom, dirty]);

  function handleFocalPointClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFocalX(Math.round(x * 100) / 100);
    setFocalY(Math.round(y * 100) / 100);
    setDirty(true);
  }

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted" aria-label="Loading editor" />
      </div>
    );
  }

  if (state === "error" && !profile) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-sm text-muted">Could not load the editor.</p>
        <Button variant="secondary" onClick={() => void loadProfile()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Hero photo section */}
      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center gap-2">
          <Camera className="size-4 text-muted" aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Hero Photo</h2>
        </div>

        <div
          ref={heroRef}
          role="button"
          tabIndex={0}
          aria-label="Set focal point by clicking on the photo"
          onClick={handleFocalPointClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
            }
          }}
          className="relative mb-4 flex aspect-[16/9] w-full cursor-crosshair items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-quiet"
        >
          {hasHero ? (
            <div className="absolute inset-0 bg-quiet" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <ImagePlus className="size-8 text-muted" aria-hidden="true" />
              <p className="text-sm text-muted">Photo upload coming soon</p>
              <p className="text-xs text-muted">
                Click anywhere to set the focal point for cropping
              </p>
            </div>
          )}
          {/* Focal point indicator */}
          <div
            className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] transition-all duration-150"
            style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
          >
            <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="flex-1">
            <label htmlFor="hero-zoom" className="mb-1 block text-sm font-medium text-ink">
              Zoom
            </label>
            <input
              id="hero-zoom"
              type="range"
              min={1}
              max={1.5}
              step={0.01}
              value={zoom}
              onChange={(e) => {
                setZoom(Number(e.target.value));
                setDirty(true);
              }}
              className="w-full accent-[color:var(--rb-brand)]"
            />
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>1x</span>
              <span>{zoom.toFixed(2)}x</span>
              <span>1.5x</span>
            </div>
          </div>
          <Button
            variant="secondary"
            disabled
            className="opacity-50"
          >
            <Upload className="size-4" aria-hidden="true" />
            Upload photo
          </Button>
        </div>

        <div className="mt-3">
          <InlineNotice kind="info">
            Photo uploads require backend storage configuration. Set the focal
            point and zoom now — they will be applied when uploads are enabled.
          </InlineNotice>
        </div>
      </section>

      {/* Logo section */}
      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center gap-2">
          <ImagePlus className="size-4 text-muted" aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Logo</h2>
        </div>

        <div className="flex items-center gap-4">
          <div className="grid size-16 place-items-center rounded-full bg-brand-soft">
            {hasLogo ? (
              <Check className="size-6 text-brand-text" aria-hidden="true" />
            ) : (
              <span className="text-2xl font-semibold text-brand-text" aria-hidden="true">
                {businessName.trim().slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm text-ink">
              {hasLogo ? "Logo uploaded" : "No logo yet"}
            </p>
            <p className="text-xs text-muted">
              Your initial is shown until you upload a logo.
            </p>
          </div>
          <Button variant="secondary" disabled className="opacity-50">
            <Upload className="size-4" aria-hidden="true" />
            Upload
          </Button>
        </div>
      </section>

      {/* Business name (read-only) */}
      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Business Name</h2>
        <p className="text-lg font-semibold text-ink">{businessName}</p>
        <p className="mt-1 text-xs text-muted">
          Change this in Settings.
        </p>
      </section>

      {/* Customer preview */}
      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted"
        >
          <Eye className="size-4" aria-hidden="true" />
          Customer Preview
          <span className={`ml-auto text-xs transition-transform ${showPreview ? "rotate-90" : ""}`}>
            &#9654;
          </span>
        </button>

        {showPreview && (
          <div className="mt-4">
            <div className="mx-auto max-w-[375px] overflow-hidden rounded-2xl border border-border bg-white shadow-lg">
              {/* Preview header */}
              <div className="relative aspect-[16/9] bg-quiet">
                {hasHero ? (
                  <div className="absolute inset-0 bg-quiet" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-sm text-muted">Hero photo</p>
                  </div>
                )}
                {/* Focal point overlay for preview */}
                <div
                  className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 ring-1 ring-black/20"
                  style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
                />
              </div>

              {/* Preview identity */}
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft">
                  <span className="text-lg font-semibold text-brand-text" aria-hidden="true">
                    {businessName.trim().slice(0, 1).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="text-base font-semibold text-ink">{businessName}</p>
                </div>
              </div>

              {/* Preview stars placeholder */}
              <div className="border-t border-border/50 px-5 py-6">
                <p className="mb-3 text-center text-sm text-muted">How was your visit?</p>
                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <div
                      key={star}
                      className="grid size-11 place-items-center rounded-full border border-[color:var(--rb-star)]/30 text-lg text-[color:var(--rb-star)]"
                    >
                      &#9733;
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview footer */}
              <div className="border-t border-border/50 px-5 py-3">
                <p className="text-center text-xs text-muted">Powered by ReviewBoost</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Publish status */}
      {isPublished && profile?.publishedAt && (
        <p className="text-sm text-muted">
          Last published {new Date(profile.publishedAt).toLocaleDateString()}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <Button
          variant="primary"
          loading={state === "publishing"}
          onClick={() => void publish()}
          className="sm:flex-1"
        >
          {isPublished ? "Publish changes" : "Publish"}
        </Button>
        <Button
          variant="secondary"
          loading={state === "saving"}
          disabled={!dirty}
          onClick={() => void saveDraft()}
          className="sm:flex-1"
        >
          Save draft
        </Button>
      </div>

      {dirty && (
        <p className="text-center text-xs text-muted">
          You have unsaved changes.
        </p>
      )}
    </div>
  );
}
