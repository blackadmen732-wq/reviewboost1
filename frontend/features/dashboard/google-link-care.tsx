"use client";

import { Check, ExternalLink, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import {
  GOOGLE_LINK_BLAST,
  GOOGLE_LINK_EMPTY,
  canOpenGoogleReviewUrl,
} from "@/features/dashboard/google-link-copy";
import { GoogleLinkHelp } from "@/features/dashboard/settings-form";
import { isValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * The Google review link, with Test / Open / Save.
 *
 * Test opens the draft before it is saved. Open opens what is already live.
 * Save writes through the existing settings API. Nothing else is invented.
 */

function openLink(url: string) {
  if (!canOpenGoogleReviewUrl(url) || !isValidatedGoogleReviewUrl(url.trim())) return;
  window.open(url.trim(), "_blank", "noopener,noreferrer");
}

export function GoogleLinkCare({ value }: { value: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const trimmed = draft.trim();
  const draftLooksRight = trimmed !== "" && isValidatedGoogleReviewUrl(trimmed);

  async function save() {
    if (trimmed !== "" && !draftLooksRight) {
      setError("That does not look like a Google review link.");
      return;
    }

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
      body: JSON.stringify({ googleReviewUrl: trimmed }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string; details?: Array<{ message?: string }> };
      } | null;
      setError(
        payload?.error?.details?.[0]?.message ??
          payload?.error?.message ??
          "Could not save that. Please try again.",
      );
      return;
    }

    setEditing(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 4000);
    router.refresh();
    notify.success("Saved", "Google link updated.");
  }

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <div className="rounded-[var(--radius-card)] border border-brand bg-surface p-4">
          <label className="block text-sm font-medium text-muted" htmlFor="setting-googleReviewUrl">
            Google link
          </label>
          <Input
            id="setting-googleReviewUrl"
            className="mt-1.5"
            type="url"
            inputMode="url"
            value={draft}
            disabled={busy}
            invalid={error !== null || (trimmed !== "" && !draftLooksRight)}
            placeholder="https://g.page/..."
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            autoFocus
          />

          {draftLooksRight ? (
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-brand-text">
              <Check className="size-4" aria-hidden="true" />
              That is the right kind of link
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-muted">{GOOGLE_LINK_BLAST}</p>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              disabled={!draftLooksRight || busy}
              onClick={() => openLink(trimmed)}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Test
            </Button>
            <Button variant="action" loading={busy} loadingLabel="Saving…" onClick={() => void save()}>
              Save
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(value ?? "");
                setError(null);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted">Google link</p>
            <p className={`break-words text-base font-medium ${value ? "text-ink" : "text-muted"}`}>
              {value || GOOGLE_LINK_EMPTY}
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
      )}

      {!editing ? <p className="max-w-[42ch] text-sm leading-relaxed text-muted">{GOOGLE_LINK_BLAST}</p> : null}

      {!editing && value ? (
        <Button
          variant="secondary"
          className="w-auto"
          onClick={() => openLink(value)}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Open
        </Button>
      ) : null}

      <GoogleLinkHelp />
    </div>
  );
}

export function TestGoogleLinkButton({ url }: { url: string }) {
  const ready = isValidatedGoogleReviewUrl(url.trim());
  return (
    <Button variant="secondary" disabled={!ready} onClick={() => openLink(url)}>
      <ExternalLink className="size-4" aria-hidden="true" />
      Test
    </Button>
  );
}
