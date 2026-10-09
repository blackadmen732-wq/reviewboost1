"use client";

import { Check, ExternalLink, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { settingSurface } from "@/components/ui/setting-list";
import { notify } from "@/components/ui/toast";
import {
  GOOGLE_LINK_BLAST,
  GOOGLE_LINK_INVALID,
  GOOGLE_LINK_LEGACY,
  GOOGLE_LINK_LEGACY_TITLE,
  GOOGLE_LINK_NOT_REVIEW_LINK,
  googleLinkDisplay,
  googleLinkRefusal,
  googleLinkState,
  googleLinkWorks,
  openGoogleReviewUrl,
} from "@/features/dashboard/google-link-copy";
import { GoogleLinkHelp } from "@/features/dashboard/settings-form";
import { isGoogleReviewWritingUrl } from "@/lib/security/google-review-url";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";

/**
 * The Google review link, with Test / Open / Save.
 *
 * Test opens the draft before it is saved. Open opens what is already live.
 * Save writes through the existing settings API. Missing and invalid are named.
 * A refused open always says why.
 */

function refuseOrOpen(url: string, onRefuse: (message: string) => void): boolean {
  const state = openGoogleReviewUrl(url);
  const refusal = googleLinkRefusal(state);
  if (refusal) {
    onRefuse(refusal);
    return false;
  }
  return true;
}

/**
 * The link belongs to one place. `locationId` is sent with every save because
 * the settings API refuses a location change that does not name its location,
 * and a business with two places must never have the wrong one edited.
 */
export function GoogleLinkCare({
  value,
  locationId,
  readOnly = false,
  inset = false,
}: {
  value: string | null;
  locationId: string;
  readOnly?: boolean;
  /** True when this row sits inside a SettingGroup card and must not draw its own. */
  inset?: boolean;
}) {
  const inputId = `setting-googleReviewUrl-${locationId}`;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const trimmed = draft.trim();
  const draftLooksRight = trimmed !== "" && isGoogleReviewWritingUrl(trimmed);
  // A listing or short link still works where it is already saved, but cannot
  // be saved as a new link; say which, rather than calling it "not Google".
  const draftRefusal = googleLinkState(trimmed) === "legacy" ? GOOGLE_LINK_NOT_REVIEW_LINK : GOOGLE_LINK_INVALID;
  const savedState = googleLinkState(value);

  function speakRefusal(message: string) {
    setError(message);
    notify.error("That link will not open", message);
  }

  async function save() {
    if (trimmed !== "" && !draftLooksRight) {
      setError(draftRefusal);
      return;
    }

    setBusy(true);
    setError(null);

    // Everything that can throw is inside the try, and `busy` is cleared in
    // `finally`. Previously a dropped connection or an auth failure threw out
    // of `save()` with `busy` still true: the button stayed in its loading
    // state forever and the owner had no way to retry but reload the page —
    // on the one field whose absence stops every Tag from working.
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();

      if (!session) {
        setError("Your session expired. Sign in again, then save.");
        notify.error("Please sign in again", "Your session expired.");
        return;
      }

      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ locationId, destinationProvider: "google", destinationUrl: trimmed }),
      });

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
    } catch {
      // Transport or auth failure: say so, and leave the draft in the field so
      // pressing Save again is the whole retry.
      setError("Could not reach ReviewBoost. Check your connection and try again.");
      notify.error("Could not save", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-google-link-state={savedState}>
      {editing ? (
        <div className={settingSurface({ inset, accent: true })}>
          <label className="block text-sm font-medium text-muted" htmlFor={inputId}>
            Google link
          </label>
          <Input
            id={inputId}
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

          {trimmed !== "" && !draftLooksRight ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {draftRefusal}
            </p>
          ) : error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-muted">{GOOGLE_LINK_BLAST}</p>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => refuseOrOpen(trimmed, speakRefusal)}
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
        <div className={cn("flex items-start gap-4", settingSurface({ inset }))}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted">Google link</p>
            <p
              className={`break-words text-base font-medium ${googleLinkWorks(savedState) ? "text-ink" : "text-muted"}`}
            >
              {googleLinkDisplay(value)}
            </p>
            {savedState === "invalid" ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {GOOGLE_LINK_INVALID}
              </p>
            ) : null}
            {savedState === "legacy" ? (
              // Working, so not an error: a status note with the one fix.
              <div role="status" className="mt-2 flex items-start gap-2 text-sm" data-google-link-upgrade>
                <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-star" />
                <p className="leading-relaxed text-ink">
                  <span className="font-semibold">{GOOGLE_LINK_LEGACY_TITLE}.</span> {GOOGLE_LINK_LEGACY}
                </p>
              </div>
            ) : null}
            {justSaved ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-text">
                <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                Saved
              </p>
            ) : null}
            {error && savedState !== "invalid" ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
          {readOnly ? null : (
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
              {savedState === "legacy" ? "Upgrade" : "Change"}
            </button>
          )}
        </div>
      )}

      {!editing ? <p className="max-w-[42ch] text-sm leading-relaxed text-muted">{GOOGLE_LINK_BLAST}</p> : null}

      {!editing && savedState !== "missing" ? (
        <Button
          variant="secondary"
          className="w-auto"
          onClick={() => refuseOrOpen(value ?? "", speakRefusal)}
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
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        onClick={() => {
          const opened = refuseOrOpen(url, setRefusal);
          if (opened) setRefusal(null);
        }}
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        Test
      </Button>
      {refusal ? (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
