"use client";

import { Check, ExternalLink, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";

/**
 * One editable setting.
 *
 * READ FIRST, EDIT ON PURPOSE
 * ---------------------------
 * Settings screens built as a wall of live inputs are hostile to this audience.
 * Every field looks like something that might already be wrong, nothing tells
 * you whether it saved, and one stray tap on a phone silently changes a value
 * nobody meant to touch.
 *
 * So each row reads as plain text with a small Edit beside it, and becomes a
 * field only once asked. There is one thing to change at a time, one Save, and
 * an unmistakable confirmation afterwards.
 *
 * Cancel restores the original rather than clearing, so backing out of an edit
 * never destroys what was there.
 */

interface EditableRowProps {
  field: string;
  label: string;
  value: string | null;
  placeholder?: string;
  help?: string;
  emptyText?: string;
  warnWhenEmpty?: boolean;
  type?: "text" | "url";
}

export function EditableRow({
  field,
  label,
  value,
  placeholder,
  help,
  emptyText = "Not set yet",
  warnWhenEmpty = false,
  type = "text",
}: EditableRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    const response = await fetch("/api/v1/settings", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ [field]: draft.trim() }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string; details?: Array<{ message?: string }> };
      } | null;

      // The server's field message is more specific than anything generic we
      // could invent here — "That does not look like a Google review link"
      // tells someone what to do; "Could not save" does not.
      setError(
        payload?.error?.details?.[0]?.message ??
          payload?.error?.message ??
          "Could not save that. Please try again.",
      );
      return;
    }

    setEditing(false);
    setJustSaved(true);
    // Long enough to be seen by someone who looked away, short enough not to
    // become permanent furniture.
    setTimeout(() => setJustSaved(false), 4000);
    router.refresh();
    notify.success("Saved", `${label} updated.`);
  }

  if (!editing) {
    const isEmpty = !value;

    return (
      <div className="flex items-start gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted">{label}</p>
          {/* break-words, not truncate: a Google URL is long and unrecognisable
              when cut off, and the point of showing it is recognition. */}
          <p
            className={cn(
              "break-words text-base font-medium",
              isEmpty && warnWhenEmpty ? "text-[color:var(--rb-warning)]" : "text-ink",
            )}
          >
            {value || emptyText}
          </p>

          {justSaved ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-text">
              <Check className="size-4" strokeWidth={3} aria-hidden="true" />
              Saved
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => {
            setDraft(value ?? "");
            setError(null);
            setEditing(true);
          }}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-brand bg-surface p-4">
      <label className="block text-sm font-medium text-muted" htmlFor={`setting-${field}`}>
        {label}
      </label>

      <Input
        id={`setting-${field}`}
        className="mt-1.5"
        type={type === "url" ? "url" : "text"}
        inputMode={type === "url" ? "url" : "text"}
        value={draft}
        disabled={busy}
        invalid={error !== null}
        placeholder={placeholder ?? ""}
        onChange={(event) => setDraft(event.target.value)}
        aria-describedby={error ? `setting-${field}-error` : undefined}
        autoFocus
      />

      {error ? (
        <p id={`setting-${field}-error`} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : help ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">{help}</p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button loading={busy} loadingLabel="Saving…" onClick={() => void save()}>
          Save
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            // Restores rather than clears: backing out of an edit must never
            // destroy what was already there.
            setDraft(value ?? "");
            setError(null);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Finding the Google link is the single hardest step in setup.
 *
 * Most owners have never seen it and do not know it exists. A link straight to
 * Google's own place-finder, with the three words that describe what to copy,
 * removes the one step where people give up and never come back.
 */
export function GoogleLinkHelp() {
  return (
    <a
      href="https://support.google.com/business/answer/7035772"
      target="_blank"
      rel="noreferrer noopener"
      className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-text underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
    >
      Where do I find this?
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}
