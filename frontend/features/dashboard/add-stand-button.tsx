"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DialogRoot, DialogContent } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";

interface AddStandButtonProps {
  locations: Array<{ locationId: string; name: string }>;
}

export function AddStandButton({ locations }: AddStandButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(
    locations[0]?.locationId ?? "",
  );
  const [label, setLabel] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  async function checkTags() {
    setBusy(true);
    try {
      const response = await ownerFetch("/api/v1/review-stands");
      if (!response.ok) throw new Error("read_failed");
      setOpen(false);
      setUncertain(false);
      setError(null);
      router.refresh();
    } catch {
      setError(
        "Could not check your Tags. Try checking again before creating another.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function handleCreate() {
    if (!selectedLocation || busy || uncertain) return;
    setBusy(true);
    setError(null);
    try {
      const response = await ownerFetch("/api/v1/review-stands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: selectedLocation,
          label: label.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(
          payload?.error?.message ??
            "Could not create a Tag. Please try again.",
        );
        if (response.status >= 500) setUncertain(true);
        return;
      }
      setOpen(false);
      setLabel("");
      notify.success(
        "Tag created",
        "Print the code or program the tag, then put it where people pay.",
      );
      router.refresh();
    } catch (caught) {
      setUncertain(!(caught instanceof SessionExpiredError));
      setError(
        caught instanceof SessionExpiredError
          ? caught.message
          : "Could not confirm creation. Check your Tags before creating another.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="action" className="w-auto" onClick={() => setOpen(true)}>
        <Plus className="size-5" aria-hidden="true" />
        Create a Tag
      </Button>

      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Create a Tag"
          description="A printed code or an NFC tag customers can use."
        >
          <div className="flex flex-col gap-4 py-2">
            {locations.length > 1 && (
              <div>
                <label
                  htmlFor="add-stand-location"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Place
                </label>
                <select
                  id="add-stand-location"
                  disabled={busy}
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
              <label
                htmlFor="add-stand-label"
                className="mb-1 block text-sm font-medium text-ink"
              >
                Label (optional)
              </label>
              <input
                id="add-stand-label"
                disabled={busy}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Back patio, Counter 2"
                maxLength={100}
                className="h-11 w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted"
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {uncertain ? (
            <Button
              variant="secondary"
              loading={busy}
              loadingLabel="Checking…"
              onClick={() => void checkTags()}
            >
              Check your Tags
            </Button>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              variant="action"
              disabled={uncertain}
              loading={busy}
              onClick={() => void handleCreate()}
              className="sm:flex-1"
            >
              Create a Tag
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="sm:flex-1"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
