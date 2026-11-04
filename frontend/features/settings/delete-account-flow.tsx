"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { OutcomeCheckNotice } from "@/components/ui/outcome-check-notice";
import { withReadDeadline, withWriteDeadline } from "@/lib/api/read-deadline";
import { useOutcomeCheck } from "@/lib/recovery/use-outcome-check";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { sameTypedName } from "@/lib/utils/typed-name";

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
  /** What a check found gone: the whole login, or just this business. */
  const gone = useRef<"login" | "business">("business");
  const check = useOutcomeCheck({
    onDone: () => void leave(gone.current === "login"),
    onNotDone: () =>
      setError("Your business was not deleted. Nothing changed. Try again."),
    onExpired: setError,
  });

  const matches = sameTypedName(typed, businessName);

  if (!isOwner) {
    // A team member can't delete the business, but can always delete their
    // own account (launch gap L1, Apple 5.1.1(v)).
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-[var(--radius-card)] border border-border bg-quiet p-4 text-base leading-relaxed text-ink">
          Only an owner can delete the business. You can delete your own
          account. The business and its ratings stay.
        </p>
        <Button variant="secondary" className="text-danger" asChild>
          <Link href="/settings/delete-my-account">Delete my account</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/settings">Keep my account</Link>
        </Button>
      </div>
    );
  }

  async function leave(signInRemoved: boolean) {
    if (!signInRemoved) {
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
  }

  async function remove() {
    if (!matches || busy || check.pending) return;
    setBusy(true);
    setError(null);

    let token: string | null = null;
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
      const sent = session.access_token;
      token = sent;
      const response = await withWriteDeadline(
        async (signal) =>
          await fetch("/api/v1/account/deletion", {
            signal,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            // The name as saved: the database checks it exactly, and what
            // was typed may differ only in quotes or spacing (sameTypedName).
            body: JSON.stringify({ confirmation: businessName.trim() }),
          }),
      );
      if (!response.ok) {
        // A server error can come after the deletion finished: find out.
        if (response.status >= 500) {
          check.start(isDeleted(sent), { serverAnswered: true });
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(
          body?.error?.message ??
            "Your business was not deleted. Nothing changed. Try again.",
        );
        return;
      }
      const result = (await response.json()) as {
        data?: { signInRemoved?: boolean };
      };
      await leave(result.data?.signInRemoved !== false);
    } catch {
      if (token === null) {
        setError("Could not verify your session. Sign in again, then try.");
        return;
      }
      // The answer was lost. Ask the server whether the business is still
      // there, rather than send the owner to look.
      check.start(isDeleted(token));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Is the business gone? Its places stop answering for it (404), or, when it
   * was the last one, the login itself is gone (401).
   */
  function isDeleted(token: string) {
    return async (signal: AbortSignal): Promise<boolean> => {
      const response = await fetch("/api/v1/locations", {
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 404) {
        gone.current = response.status === 401 ? "login" : "business";
        return true;
      }
      if (!response.ok) throw new Error("No answer yet.");
      return false;
    };
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
          disabled={busy || check.pending}
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

      <OutcomeCheckNotice check={check} />
      <div className="flex flex-col gap-3">
        <Button
          variant="destructive"
          disabled={!matches || check.pending}
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

      <p className="text-sm leading-relaxed text-muted">
        Want to keep the business and remove only yourself?{" "}
        <Link
          href="/settings/delete-my-account"
          className="font-medium text-ink underline underline-offset-4 hover:no-underline"
        >
          Delete only my account
        </Link>
        . The business needs another owner first.
      </p>
    </div>
  );
}
