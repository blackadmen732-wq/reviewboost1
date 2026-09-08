"use client";

import { Check } from "lucide-react";

import { BusinessHero } from "@/features/customer-page/business-hero";
import { looks } from "@/lib/customer-page/looks";
import type { CustomerPageDesign, LookId } from "@/lib/customer-page/design";

interface LookPickerProps {
  design: CustomerPageDesign;
  businessName: string;
  logoAlt: string;
  disabled?: boolean;
  onChange: (design: CustomerPageDesign) => void;
}

/**
 * Six finished results, shown as themselves.
 *
 * Every thumbnail is the real hero component with the owner's real photograph
 * and real business name — not a swatch, not a font sample, not a stock preview.
 * The customer page's typography is sized in container units, so a hero rendered
 * into a 150px card composes exactly as it will at 390px, which is the whole
 * reason an owner can choose from thumbnails and be right.
 */
export function LookPicker({
  design,
  businessName,
  logoAlt,
  disabled = false,
  onChange,
}: LookPickerProps) {
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <div>
        <legend className="text-base font-semibold tracking-[-0.01em] text-ink">
          Choose a look
        </legend>
        <p className="mt-0.5 text-sm text-muted">
          Choose how your business appears over the photo.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {looks.map((look) => {
          const selected = design.look === look.id;
          return (
            <label
              key={look.id}
              className="group relative flex cursor-pointer flex-col gap-1.5"
            >
              <input
                type="radio"
                name="customer-page-look"
                value={look.id}
                checked={selected}
                onChange={() => onChange({ ...design, look: look.id as LookId })}
                className="peer sr-only"
              />

              <span
                className={[
                  "cp-look-thumb relative block overflow-hidden rounded-[14px] border-2 bg-[#100c09]",
                  "transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
                  "peer-focus-visible:ring-4 peer-focus-visible:ring-[color:var(--rb-focus-soft)]",
                  selected
                    ? "border-ink shadow-[var(--shadow-control)]"
                    : "border-transparent group-hover:border-[color:var(--rb-border-strong)]",
                ].join(" ")}
              >
                {/* The container query the wordmark reads resolves against the
                    hero itself, so this needs no scaling of its own. */}
                <BusinessHero
                  businessName={businessName}
                  design={{ ...design, look: look.id, tagline: null }}
                  logoAlt={logoAlt}
                />
                {selected ? (
                  <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-ink text-white">
                    <Check className="size-3.5" aria-hidden="true" strokeWidth={3} />
                  </span>
                ) : null}
              </span>

              <span
                className={[
                  "text-center text-xs font-semibold",
                  selected ? "text-ink" : "text-muted",
                ].join(" ")}
              >
                {look.label}
              </span>
            </label>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {looks.find((look) => look.id === design.look)?.description}
      </p>
    </fieldset>
  );
}
