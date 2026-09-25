"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Add a place, through `POST /api/v1/locations`.
 *
 * The plan limit is enforced by `rpc_create_location` under a lock; this
 * button is only offered when the snapshot says there is room, and if the
 * database disagrees its message is shown as it comes back.
 */
export function AddLocationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give this place a name.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      if (!session) {
        setError("Your session expired. Sign in again, then try.");
        return;
      }

      const response = await fetch("/api/v1/locations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? "Could not add that place. Please try again.");
        return;
      }

      setOpen(false);
      setName("");
      notify.success("Place added", "Add its Google link so its Tags have somewhere to send people.");
      router.refresh();
    } catch {
      setError("Could not reach ReviewBoost. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" className="w-auto" onClick={() => setOpen(true)}>
        <Plus className="size-5" aria-hidden="true" />
        Add a place
      </Button>

      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Add a place"
          description="Another location with its own Tags and its own Google link."
        >
          <div className="py-2">
            <label htmlFor="add-location-name" className="mb-1 block text-sm font-medium text-ink">
              Name
            </label>
            <Input
              id="add-location-name"
              value={name}
              maxLength={160}
              placeholder="e.g. Downtown"
              invalid={error !== null}
              aria-describedby={error ? "add-location-error" : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p id="add-location-error" role="alert" className="mt-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              variant="action"
              loading={busy}
              loadingLabel="Adding…"
              onClick={() => void create()}
              className="sm:flex-1"
            >
              Add place
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="sm:flex-1">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
