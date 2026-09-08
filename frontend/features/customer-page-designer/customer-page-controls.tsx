"use client";

import { Info } from "lucide-react";

import { Input } from "@/components/ui/input";
import { LocationScopeSelector } from "@/features/customer-page-designer/location-scope-selector";
import { LogoControl } from "@/features/customer-page-designer/logo-control";
import { LookPicker } from "@/features/customer-page-designer/look-picker";
import { PhotoControl } from "@/features/customer-page-designer/photo-control";
import {
  maxTaglineLength,
  type CustomerPageDesign,
} from "@/lib/customer-page/design";

export interface DesignerLocation {
  locationId: string;
  name: string;
}

interface CustomerPageControlsProps {
  design: CustomerPageDesign;
  businessName: string;
  logoAlt: string;
  locations: readonly DesignerLocation[];
  locationId: string | null;
  canEdit: boolean;
  onChange: (design: CustomerPageDesign) => void;
  onScopeChange: (locationId: string | null) => void;
}

/**
 * Everything the owner can change, in the order they will change it.
 *
 * Photo, then logo, then look: the first control is the one that makes the page
 * stop looking empty, and each one after it is optional. An owner who does the
 * first thing and publishes has a finished page.
 */
export function CustomerPageControls({
  design,
  businessName,
  logoAlt,
  locations,
  locationId,
  canEdit,
  onChange,
  onScopeChange,
}: CustomerPageControlsProps) {
  return (
    <div className="flex flex-col gap-7">
      {!canEdit ? (
        <p className="inline-flex items-start gap-2 rounded-[var(--radius-control)] bg-quiet p-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          You can see this page but not change it. Ask an owner or admin for
          access.
        </p>
      ) : null}

      {/* A single-location business is never shown that locations exist. */}
      {locations.length > 1 ? (
        <LocationScopeSelector
          locations={locations}
          locationId={locationId}
          disabled={!canEdit}
          onChange={onScopeChange}
        />
      ) : null}

      <PhotoControl
        design={design}
        businessName={businessName}
        logoAlt={logoAlt}
        disabled={!canEdit}
        onChange={onChange}
      />

      <LogoControl
        design={design}
        logoAlt={logoAlt}
        disabled={!canEdit}
        onChange={onChange}
      />

      <LookPicker
        design={design}
        businessName={businessName}
        logoAlt={logoAlt}
        disabled={!canEdit}
        onChange={onChange}
      />

      <section className="flex flex-col gap-2">
        <label
          htmlFor="customer-page-tagline"
          className="text-base font-semibold tracking-[-0.01em] text-ink"
        >
          Tagline <span className="font-normal text-muted">· Optional</span>
        </label>
        <Input
          id="customer-page-tagline"
          value={design.tagline ?? ""}
          maxLength={maxTaglineLength}
          disabled={!canEdit}
          placeholder="A few words about your business"
          onChange={(event) =>
            onChange({ ...design, tagline: event.target.value || null })
          }
        />
      </section>
    </div>
  );
}
