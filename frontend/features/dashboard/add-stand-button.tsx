"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DialogRoot, DialogContent } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface AddStandButtonProps {
  locations: Array<{ locationId: string; name: string }>;
}

export function AddStandButton({ locations }: AddStandButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(locations[0]?.locationId ?? "");
  const [label, setLabel] = useState("");

  async function handleCreate() {
    if (!selectedLocation) return;
    setBusy(true);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    const response = await fetch("/api/v1/review-stands", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId: selectedLocation,
        label: label.trim() || undefined,
      }),
    });

    setBusy(false);

    if (!response.ok) {
      notify.error("Could not create a Tag", "Please try again.");
      return;
    }

    setOpen(false);
    setLabel("");
    notify.success("Tag created", "Print the code or program the tag, then put it where people pay.");
    router.refresh();
  }

  return (
    <>
      <Button variant="action" className="w-auto" onClick={() => setOpen(true)}>
        <Plus className="size-5" aria-hidden="true" />
        Create a Tag
      </Button>

      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent title="Create a Tag" description="A printed code or an NFC tag customers can use.">
          <div className="flex flex-col gap-4 py-2">
            {locations.length > 1 && (
              <div>
                <label htmlFor="add-stand-location" className="mb-1 block text-sm font-medium text-ink">
                  Place
                </label>
                <select
                  id="add-stand-location"
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className="h-11 w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-ink"
                >
                  {locations.map((loc) => (
                    <option key={loc.locationId} value={loc.locationId}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="add-stand-label" className="mb-1 block text-sm font-medium text-ink">
                Label (optional)
              </label>
              <input
                id="add-stand-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Back patio, Counter 2"
                maxLength={100}
                className="h-11 w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="action" loading={busy} onClick={() => void handleCreate()} className="sm:flex-1">
              Create a Tag
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} className="sm:flex-1">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
