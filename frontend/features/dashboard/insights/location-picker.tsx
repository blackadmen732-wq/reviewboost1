"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId } from "react";

/**
 * All locations, or one — for a business with more than one.
 *
 * A native select on purpose: on a phone it opens the system's own picker from
 * the bottom of the screen, reachable with the thumb that is holding the
 * phone, and it is keyboard- and screen-reader-complete without any help.
 */
export function LocationPicker({
  locations,
  selected,
  range,
}: {
  locations: ReadonlyArray<{ locationId: string; name: string }>;
  selected: string | null;
  range: number;
}) {
  const router = useRouter();
  const id = useId();

  return (
    <div className="relative w-full sm:w-auto">
      <label htmlFor={id} className="sr-only">
        Location
      </label>
      <select
        id={id}
        value={selected ?? ""}
        onChange={(event) => {
          const params = new URLSearchParams();
          if (range !== 30) params.set("days", String(range));
          if (event.target.value) params.set("location", event.target.value);
          const query = params.toString();
          router.push(`/feedback/insights${query ? `?${query}` : ""}`);
        }}
        className="min-h-11 w-full appearance-none rounded-full border border-border bg-surface py-2 pl-4 pr-10 text-sm font-medium text-ink transition-colors duration-150 hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] sm:w-auto sm:min-w-[12rem]"
      >
        <option value="">All locations</option>
        {locations.map((location) => (
          <option key={location.locationId} value={location.locationId}>
            {location.name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
    </div>
  );
}
