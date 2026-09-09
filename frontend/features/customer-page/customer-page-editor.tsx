"use client";

import { Download, ImagePlus, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { VisitStars } from "@/features/customer-page/visit-stars";
import { downloadBlankCustomerTemplate } from "@/features/customer-page/blank-template";
import { useHeroGestures } from "@/features/customer-page/use-hero-gestures";
import { type HeroTransform } from "@/lib/owner/hero-transform";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { supabaseBrowser } from "@/lib/supabase/browser";

const messages = customerMessages.en;

export interface CustomerPageEditorModel {
  draft: HeroTransform;
  draftTagline: string | null;
  hasDraftHero: boolean;
  hasPublishedHero: boolean;
  publishedAt: string | null;
  draftArtworkUrl: string;
}

export function CustomerPageEditor({ initial }: { initial: CustomerPageEditorModel }) {
  const [transform, setTransform] = useState<HeroTransform>(initial.draft);
  const [heroUrl, setHeroUrl] = useState<string | null>(
    initial.hasDraftHero
      ? `${initial.draftArtworkUrl}&t=${initial.publishedAt ?? "draft"}`
      : null,
  );
  const [busy, setBusy] = useState<"upload" | "publish" | null>(null);
  const [live, setLive] = useState(Boolean(initial.hasPublishedHero && initial.publishedAt));
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
      notify.error("Could not add that photo", "Use a JPG or PNG under 2 MB.");
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    const headers = await authHeaders();
    if (!headers) return;
    setBusy("publish");
    try {
      const response = await fetch("/api/v1/customer-page", {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ transform, publish: true }),
      });
      if (!response.ok) throw new Error("publish");
      setLive(true);
      notify.success("Published", "Tags now open this page.");
    } catch {
      notify.error("Could not publish", "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="customer-page-editor">
      <div className="customer-page-editor__preview">
        <p className="mb-3 text-sm font-medium text-muted">
          {live ? "On your Tags" : "Not on Tags yet"}
        </p>
        <PhoneFrame>
          <CustomerVisitView
            heroUrl={heroUrl}
            transform={transform}
            heading={messages.ratingHeading}
            support={messages.ratingSupport}
            footerLine={messages.footerPromise}
            heroInteractive={Boolean(heroUrl)}
            {...gestures}
          >
            <VisitStars value={null} messages={messages} preview />
          </CustomerVisitView>
        </PhoneFrame>
      </div>

      <div className="customer-page-editor__rail">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Your photo</h2>
        <p className="mt-1 text-base text-muted">Drag to move. Stars stay put.</p>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
            event.target.value = "";
          }}
        />

        <div className="mt-5 flex flex-col gap-3">
          <Button
            variant="action"
            size="lg"
            onClick={() => fileRef.current?.click()}
            loading={busy === "upload"}
          >
            <ImagePlus className="size-5" aria-hidden="true" />
            {heroUrl ? "Replace photo" : "Add photo"}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void publish()} loading={busy === "publish"}>
            <Upload className="size-5" aria-hidden="true" />
            Publish
          </Button>
          <Button variant="secondary" size="lg" onClick={() => downloadBlankCustomerTemplate()}>
            <Download className="size-5" aria-hidden="true" />
            Download blank page
          </Button>
        </div>
      </div>
    </div>
  );
}
