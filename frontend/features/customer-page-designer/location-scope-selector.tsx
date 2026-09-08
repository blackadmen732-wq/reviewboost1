"use client";

import type { DesignerLocation } from "@/features/customer-page-designer/customer-page-controls";

interface LocationScopeSelectorProps {
  locations: readonly DesignerLocation[];
  locationId: string | null;
  disabled?: boolean;
  onChange: (locationId: string | null) => void;
}

/**
 * Which page is being edited, for the businesses that have more than one.
 *
 * The default is one design for everywhere, because that is what almost every
 * multi-location business actually wants and because the alternative — a design
 * per location, per tag — is how a two-minute setup becomes an afternoon. A
 * location is only customised when the owner asks for it by selecting it.
 */
export function LocationScopeSelector({
  locations,
  locationId,
  disabled = false,
  onChange,
}: LocationScopeSelectorProps) {
  return (
    <section className="flex flex-col gap-2">
      <label
        htmlFor="customer-page-scope"
        className="text-base font-semibold tracking-[-0.01em] text-ink"
      >
        Editing
      </label>
      <select
        id="customer-page-scope"
        className="input"
        value={locationId ?? "all"}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === "all" ? null : event.target.value)
        }
      >
        <option value="all">All locations</option>
        {locations.map((location) => (
          <option key={location.locationId} value={location.locationId}>
            {location.name}
          </option>
        ))}
      </select>
      <p className="text-sm text-muted">
        {locationId === null
          ? "Every location uses this design unless you customise it."
          : "This location only. Publishing here leaves your other locations alone."}
      </p>
    </section>
  );
}
