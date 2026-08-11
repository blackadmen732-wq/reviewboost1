"use client";

import { Check, Plus, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogRoot, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import type { StaffMember } from "@/lib/server/owner-data";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";

/**
 * "Who is this?" — turning a typed first name into a person on the team.
 *
 * THE HARD PART IS THE FIRST TIME
 * -------------------------------
 * On day one the roster is empty, so a picker showing an empty list is a dead
 * end. The name the customer typed is therefore offered as the first option:
 * one tap creates that person and matches the praise in the same motion. By the
 * third piece of praise the roster exists and the tap is just a pick.
 *
 * That is the whole reason there is no separate "manage your team" screen to
 * visit first. Making someone build a roster before the feature does anything is
 * how a good feature goes unused.
 *
 * A sheet rather than a page. The praise itself has to stay visible while
 * choosing — the customer's words are the evidence for the decision, and sending
 * someone to another screen to make it means deciding from memory.
 */
export function PraiseMatcher({
  praiseId,
  typedName,
  staff,
  matchedStaffId,
  matchedStaffName,
}: {
  praiseId: string;
  typedName: string;
  staff: StaffMember[];
  matchedStaffId: string | null;
  matchedStaffName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  async function authorized() {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      notify.error("Please sign in again", "Your session expired.");
      return null;
    }
    return {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  async function matchTo(staffId: string | null) {
    setBusy(true);
    const headers = await authorized();
    if (!headers) return setBusy(false);

    const response = await fetch(`/api/v1/team-praise/${praiseId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ staffId }),
    });

    setBusy(false);

    if (!response.ok) {
      notify.error("Could not save that", "Please try again.");
      return;
    }

    setOpen(false);
    router.refresh();
    if (staffId) notify.success("Matched", "Now tell them.");
  }

  /** Creates the person and matches in one motion — see the note above. */
  async function createAndMatch(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    const headers = await authorized();
    if (!headers) return setBusy(false);

    const created = await fetch("/api/v1/staff", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: trimmed }),
    });

    if (!created.ok) {
      setBusy(false);
      notify.error("Could not add them", "Please try again.");
      return;
    }

    const { data } = (await created.json()) as { data: { staffId: string } };

    const matched = await fetch(`/api/v1/team-praise/${praiseId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ staffId: data.staffId }),
    });

    setBusy(false);

    if (!matched.ok) {
      // The person exists now even though the match failed, so say so rather
      // than implying nothing happened and inviting a duplicate.
      notify.error("Added them, but could not match", "Try matching again.");
      router.refresh();
      return;
    }

    setAdding(false);
    setNewName("");
    setOpen(false);
    router.refresh();
    notify.success(`Added ${trimmed}`, "Now tell them.");
  }

  // Someone already on the roster whose name matches what the customer typed.
  // Offering "Add Amara" when Amara is right there is how duplicate rosters
  // start.
  const alreadyOnRoster = staff.some(
    (member) => member.name.toLocaleLowerCase() === typedName.toLocaleLowerCase(),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold",
          "transition-[background-color,transform] duration-150",
          "active:scale-[0.97] motion-reduce:active:scale-100",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
          matchedStaffId
            ? "bg-brand-soft text-brand-text"
            : "bg-[color:var(--rb-star)]/20 text-[color:var(--rb-warning)]",
        )}
      >
        {matchedStaffId ? (
          <>
            <Check className="size-4" strokeWidth={3} aria-hidden="true" />
            {matchedStaffName ?? "Matched"}
          </>
        ) : (
          <>
            <UserPlus className="size-4" aria-hidden="true" />
            Who is this?
          </>
        )}
      </button>

      <DialogRoot open={open} onOpenChange={setOpen}>
        <SheetContent
          title={`Who is “${typedName}”?`}
          description="Pick the person your customer meant."
        >
          <ul className="flex flex-col gap-2">
            {/* The typed name, offered as a new person. First in the list on an
                empty roster, because on day one it is the only useful action. */}
            {!alreadyOnRoster ? (
              <li>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void createAndMatch(typedName)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-card)] border border-brand bg-brand-soft px-4 text-left transition-transform duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:opacity-50 motion-reduce:active:scale-100"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-on-brand">
                    <Plus className="size-5" strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-ink">
                      Add {typedName}
                    </span>
                    <span className="block text-sm text-brand-text">New person on your team</span>
                  </span>
                </button>
              </li>
            ) : null}

            {staff.map((member) => (
              <li key={member.staffId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void matchTo(member.staffId)}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-card)] border px-4 text-left",
                    "transition-transform duration-150 active:scale-[0.99] motion-reduce:active:scale-100",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                    "disabled:opacity-50",
                    member.staffId === matchedStaffId
                      ? "border-brand bg-brand-soft"
                      : "border-border bg-surface",
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-quiet text-sm font-semibold text-ink">
                    {member.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-ink">
                      {member.name}
                      {member.isActive ? "" : " (left)"}
                    </span>
                    {member.roleLabel ? (
                      <span className="block truncate text-sm text-muted">{member.roleLabel}</span>
                    ) : null}
                  </span>
                  {member.staffId === matchedStaffId ? (
                    <Check className="size-5 shrink-0 text-brand-text" strokeWidth={3} aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            ))}

            {matchedStaffId ? (
              <li>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void matchTo(null)}
                  className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:opacity-50"
                >
                  <X className="size-4" aria-hidden="true" />
                  Wrong person — undo
                </button>
              </li>
            ) : null}
          </ul>

          {/* Someone whose name the customer got wrong. Kept below the list, so
              the common case stays one tap and this is there when needed. */}
          {adding ? (
            <div className="mt-3 rounded-[var(--radius-card)] border border-brand bg-surface p-4">
              <label className="block text-sm font-medium text-muted" htmlFor="new-staff-name">
                Their name
              </label>
              <Input
                id="new-staff-name"
                className="mt-1.5"
                value={newName}
                disabled={busy}
                placeholder="Amara"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createAndMatch(newName);
                }}
                autoFocus
              />
              <div className="mt-3 flex gap-2">
                <Button
                  loading={busy}
                  loadingLabel="Adding…"
                  disabled={newName.trim().length === 0}
                  onClick={() => void createAndMatch(newName)}
                >
                  Add and match
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-brand-text transition-colors hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              Someone else
            </button>
          )}
        </SheetContent>
      </DialogRoot>
    </>
  );
}
