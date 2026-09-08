"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CustomerPageDesign } from "@/lib/customer-page/design";
import { acceptedImageTypes, readImageFile } from "@/lib/customer-page/image-file";

interface LogoControlProps {
  design: CustomerPageDesign;
  logoAlt: string;
  disabled?: boolean;
  onChange: (design: CustomerPageDesign) => void;
}

/**
 * The logo, if there is one.
 *
 * Optional and stays optional: a business without a logo gets a typographic
 * wordmark built from its real name, which is a finished result rather than a
 * placeholder. There is no logo editor here for the same reason — a logo is
 * already a finished thing, and the only useful operations are having one,
 * replacing it, and not having one.
 */
export function LogoControl({
  design,
  logoAlt,
  disabled = false,
  onChange,
}: LogoControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);

    const result = await readImageFile(file, "logo");
    setBusy(false);
    if (!result.ok) {
      setProblem("We couldn’t read that logo. Try a PNG or SVG export.");
      return;
    }
    onChange({ ...design, logo: result.source });
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">
          Logo{" "}
          <span className="font-normal text-muted">· Optional</span>
        </h2>
        {!design.logo ? (
          <p className="mt-0.5 text-sm text-muted">
            We’ll use your business name instead.
          </p>
        ) : null}
      </div>

      {design.logo ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={design.logo}
            alt={logoAlt}
            className="h-16 w-16 shrink-0 rounded-[14px] border border-border bg-[#241d17] object-contain p-2"
          />
          <div className="flex flex-1 flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="w-auto"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              Change logo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-auto text-muted"
              disabled={disabled}
              onClick={() => onChange({ ...design, logo: null })}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remove logo
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="w-auto"
          disabled={disabled || busy}
          loading={busy}
          loadingLabel="Reading logo…"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          Add logo
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
          event.target.value = "";
        }}
      />

      {problem ? (
        <p role="alert" className="text-sm text-[color:var(--rb-danger)]">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
