"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Deleting the account, from inside the account.
 *
 * WHY TYPING THE NAME AND NOT A DIALOG
 * ------------------------------------
 * A confirm dialog is muscle memory. Everyone has dismissed hundreds, and the
 * ones that mattered looked identical to the ones that did not. Typing the
 * business's own name cannot be done by reflex — it requires reading the
 * sentence that says what is about to happen — and it is the same reason
 * `rpc_delete_organization` checks the name too rather than trusting this form.
 *
 * WHY THE CONSEQUENCES ARE LISTED BEFORE THE FIELD
 * ------------------------------------------------
 * The Tags on the counter stop working. That is the part an owner does not
 * predict, and finding out afterwards is finding out too late. It is stated
 * above the input, at the same size as everything else, rather than in small
 * print under the button.
 */
export function DeleteAccountFlow({
  businessName,
  isOwner,
}: {
  businessName: string;
  isOwner: boolean;
}) {
  const fieldId = useId();
  const errorId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim().toLowerCase() === businessName.trim().toLowerCase();

  if (!isOwner) {
    return (
      <p className="rounded-[var(--radius-card)] border border-border bg-quiet p-4 text-base leading-relaxed text-ink">
        Only an owner can delete the business. If you want your own access
        removed, ask an owner to remove you from the team.
      </p>
    );
  }

  async function remove() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      setError("Your session expired. Sign in again, then delete.");
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/v1/account/deletion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ confirmation: typed.trim() }),
      });
    } catch {
      setBusy(false);
      setError("We could not reach ReviewBoost. Nothing has been deleted.");
      return;
    }

    if (!response.ok) {
      setBusy(false);
      // The server distinguishes "we could not cancel your subscription" from
      // "that is not the business name", and both are things a person can act
      // on, so its sentence is shown rather than a generic one.
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(
        body?.error?.message ??
          "Something went wrong and nothing has been deleted. Try again shortly.",
      );
      return;
    }

    // The session is worthless now — on the usual path the login it belonged to
    // no longer exists. Clearing it locally first keeps the goodbye page from
    // being rendered by a layout still trying to load a deleted business.
    try {
      await supabaseBrowser().auth.signOut();
    } catch {
      // Already unusable server-side; nothing here changes the outcome.
    }

    // A full document navigation, like signing out: the client Router Cache
    // holds rendered Server Component payloads containing this business's
    // feedback, and a soft navigation can serve them from memory afterwards.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above
    window.location.assign("/goodbye");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The shared notice rather than one-off opacity classes: `--rb-danger`
          and `--rb-danger-soft` both have dark-mode values, and a hand-rolled
          `bg-danger/5` would have kept a light tint behind light text. */}
      <InlineNotice kind="error" title="This cannot be undone.">
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>The Tags on your counter stop working. Take them down, or expect to.</li>
          <li>Every rating your customers left is deleted.</li>
          <li>Your subscription is cancelled as part of this.</li>
        </ul>
      </InlineNotice>

      <p className="text-base leading-relaxed text-muted">
        If you only want the billing to stop,{" "}
        <Link
          href="/settings/billing"
          className="font-medium text-ink underline underline-offset-4 hover:no-underline"
        >
          cancel your plan
        </Link>{" "}
        instead. That keeps your account and your ratings, and you can come back.
      </p>

      <div>
        <label htmlFor={fieldId} className="mb-2 block text-base font-medium text-ink">
          Type <span className="font-semibold">{businessName}</span> to confirm
        </label>
        <Input
          id={fieldId}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={busy}
          {...(error ? { "aria-invalid": true, "aria-describedby": errorId } : {})}
        />
      </div>

      {error ? (
        <InlineNotice id={errorId} kind="error" blocking>
          {error}
        </InlineNotice>
      ) : null}

      <div className="flex flex-col gap-3">
        <Button
          variant="destructive"
          disabled={!matches}
          loading={busy}
          loadingLabel="Deleting…"
          onClick={remove}
        >
          Delete this business
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/settings">Keep my account</Link>
        </Button>
      </div>
    </div>
  );
}
