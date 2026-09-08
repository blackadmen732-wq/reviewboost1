"use client";

import { useRef, useState } from "react";
import { Crop, ImagePlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { PhotoFocalEditor } from "@/features/customer-page-designer/photo-focal-editor";
import { heroAspectRatio } from "@/features/customer-page-designer/hero-frame";
import type { CustomerPageDesign } from "@/lib/customer-page/design";
import { acceptedImageTypes, readImageFile } from "@/lib/customer-page/image-file";

interface PhotoControlProps {
  design: CustomerPageDesign;
  businessName: string;
  logoAlt: string;
  disabled?: boolean;
  onChange: (design: CustomerPageDesign) => void;
}

const problems: Record<"type" | "size" | "decode", string> = {
  type: "That file isn’t an image we can use. Try a JPG, PNG, or WebP.",
  size: "That photo is too large. Try one under 20MB.",
  decode: "We couldn’t read that photo. Try a different one.",
};

/**
 * One photograph, chosen and positioned.
 *
 * Deliberately three buttons and no upload dialog: the owner has a photo of
 * their business on their phone, and the distance between having it and seeing
 * their page finished should be one tap and one crop. Everything a photo editor
 * would offer — brightness, filters, background removal — is absent because none
 * of it makes a business look more like itself.
 */
export function PhotoControl({
  design,
  businessName,
  logoAlt,
  disabled = false,
  onChange,
}: PhotoControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);

    const result = await readImageFile(file, "hero");
    setBusy(false);
    if (!result.ok) {
      setProblem(problems[result.reason]);
      return;
    }

    // A new photograph is a new composition, so the old crop does not survive it.
    onChange({ ...design, heroImage: result.source, heroFocalX: 50, heroFocalY: 50, heroZoom: 1 });
    setEditing(true);
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">
          Business photo
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          Choose one photo that feels like your business.
        </p>
      </div>

      {design.heroImage ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={design.heroImage}
            alt=""
            className="h-16 w-16 shrink-0 rounded-[14px] border border-border object-cover"
            style={{
              objectPosition: `${design.heroFocalX}% ${design.heroFocalY}%`,
              aspectRatio: heroAspectRatio,
            }}
          />
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="w-auto"
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              <Crop className="size-4" aria-hidden="true" />
              Adjust photo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-auto"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              Change photo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-auto text-muted"
              disabled={disabled}
              onClick={() => onChange({ ...design, heroImage: null })}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="sr-only">Remove photo</span>
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          disabled={disabled || busy}
          loading={busy}
          loadingLabel="Reading photo…"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="size-5" aria-hidden="true" />
          Add photo
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={acceptedImageTypes.join(",")}
        className="sr-only"
        /* The button above is the control; this is the mechanism it drives.
           Left in the accessibility tree it is a second, unlabelled way to do
           the same thing. */
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          // Lets the owner pick the same file again after removing it.
          event.target.value = "";
        }}
      />

      {problem ? (
        <p role="alert" className="text-sm text-[color:var(--rb-danger)]">
          {problem}
        </p>
      ) : null}

      <DialogRoot open={editing} onOpenChange={setEditing}>
        <DialogContent
          title="Adjust photo"
          description="Move the photo so what matters sits where your name isn’t."
        >
          <PhotoFocalEditor
            design={design}
            businessName={businessName}
            logoAlt={logoAlt}
            onChange={onChange}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </DialogRoot>
    </section>
  );
}
