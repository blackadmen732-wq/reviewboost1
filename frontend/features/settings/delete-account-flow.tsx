"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { withReadDeadline, withWriteDeadline } from "@/lib/api/read-deadline";
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
  const [uncertain, setUncertain] = useState(false);

  const matches =
    typed.trim().toLowerCase() === businessName.trim().toLowerCase();

  if (!isOwner) {
    return (
      <p className="rounded-[var(--radius-card)] border border-border bg-quiet p-4 text-base leading-relaxed text-ink">
        Only an owner can delete the business. If you want your own access
        removed, ask an owner to remove you from the team.
      </p>
    );
  }

  async function remove() {
    if (!matches || busy || uncertain) return;
    setBusy(true);
    setError(null);

    let attempted = false;
    try {
      const {
        data: { session },
      } = await withReadDeadline(
        async () => await supabaseBrowser().auth.getSession(),
      );
      if (!session) {
        setError("Your session expired. Sign in again, then delete.");
        return;
      }
      attempted = true;
      const response = await withWriteDeadline(
        async (signal) =>
          await fetch("/api/v1/account/deletion", {
            signal,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ confirmation: typed.trim() }),
          }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        if (response.status >= 500) setUncertain(true);
        setError(
          body?.error?.message ??
            "Could not confirm deletion. Check your businesses before trying again.",
        );
        return;
      }
      const result = (await response.json()) as {
        data?: { signInRemoved?: boolean };
      };
      if (result.data?.signInRemoved === false) {
        // Another membership survives. Keep its valid session and discard only
        // the deleted business's cached document through a full navigation.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/select-org");
        return;
      }
      try {
        await supabaseBrowser().auth.signOut();
      } catch {
        /* The deleted login is unusable server-side. */
      }
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/goodbye");
    } catch {
      setUncertain(attempted);
      setError(
        attempted
          ? "Could not confirm whether deletion finished. Check your businesses before trying again."
          : "Could not verify your session. Sign in again, then try.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The shared notice rather than one-off opacity classes: `--rb-danger`
          and `--rb-danger-soft` both have dark-mode values, and a hand-rolled
          `bg-danger/5` would have kept a light tint behind light text. */}
      <InlineNotice kind="error" title="This cannot be undone.">
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            The Tags on your counter stop working. Take them down, or expect to.
          </li>
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
        instead. That keeps your account and your ratings, and you can come
        back.
      </p>

      <div>
        <label
          htmlFor={fieldId}
          className="mb-2 block text-base font-medium text-ink"
        >
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
          {...(error
            ? { "aria-invalid": true, "aria-describedby": errorId }
            : {})}
        />
      </div>

      {error ? (
        <InlineNotice id={errorId} kind="error" blocking>
          {error}
        </InlineNotice>
      ) : null}

      {uncertain ? (
        <Button variant="secondary" asChild>
          <Link href="/select-org">Check my businesses</Link>
        </Button>
      ) : null}
      <div className="flex flex-col gap-3">
        <Button
          variant="destructive"
          disabled={!matches || uncertain}
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
