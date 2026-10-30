"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { withReadDeadline, withWriteDeadline } from "@/lib/api/read-deadline";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Deleting your own login (launch gap L1).
 *
 * For a team member, or someone who signed in and never made a business. The
 * owner of a business deletes the business instead (DeleteAccountFlow), which
 * removes their login too when it was their last.
 *
 * The screen first asks the server whether deleting is allowed, so the only
 * owner of a business is told which one, and what to do, before typing
 * anything. The server checks again on delete; this is for the person, not
 * for safety.
 */

type Check =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "allowed" }
  | { kind: "blocked"; names: string[] };

const WORD = "delete";

async function accessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await withReadDeadline(async () => await supabaseBrowser().auth.getSession());
  return session?.access_token ?? null;
}

/** Ask the server whether this person may delete their login now. */
async function fetchCheck(): Promise<Check> {
  try {
    const token = await accessToken();
    if (!token) return { kind: "error" };
    const response = await withReadDeadline(
      async (signal) =>
        await fetch("/api/v1/account/personal-deletion", {
          signal,
          headers: { Authorization: `Bearer ${token}` },
        }),
    );
    if (!response.ok) return { kind: "error" };
    const body = (await response.json()) as {
      data: { allowed: boolean; blockers: Array<{ name: string }> };
    };
    return body.data.allowed
      ? { kind: "allowed" }
      : { kind: "blocked", names: body.data.blockers.map((blocker) => blocker.name) };
  } catch {
    return { kind: "error" };
  }
}

export function PersonalDeletionFlow() {
  const fieldId = useId();
  const errorId = useId();
  const [check, setCheck] = useState<Check>({ kind: "loading" });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchCheck().then((next) => {
      if (alive) setCheck(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const retry = useCallback(() => {
    setCheck({ kind: "loading" });
    void fetchCheck().then(setCheck);
  }, []);

  async function remove() {
    if (busy || uncertain) return;
    if (typed.trim().toLowerCase() !== WORD) {
      setError("Type delete to confirm.");
      return;
    }
    setBusy(true);
    setError(null);

    let attempted = false;
    try {
      const token = await accessToken();
      if (!token) {
        setError("Your session expired. Sign in again, then delete.");
        return;
      }
      attempted = true;
      const response = await withWriteDeadline(
        async (signal) =>
          await fetch("/api/v1/account/personal-deletion", {
            signal,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ confirmation: typed.trim() }),
          }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string; message?: string; details?: Array<{ message: string }> };
        } | null;
        if (body?.error?.code === "owns_business") {
          setCheck({
            kind: "blocked",
            names: (body.error.details ?? []).map((detail) => detail.message),
          });
          return;
        }
        if (response.status >= 500) setUncertain(true);
        setError(body?.error?.message ?? "Your account was not deleted. Try again shortly.");
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
      // A lost response: the login may or may not be gone. Reloading answers
      // it, because a deleted login can no longer load this page.
      setUncertain(attempted);
      setError(
        attempted
          ? "We couldn't confirm whether your account was deleted. Reload this page to check before trying again."
          : "Could not verify your session. Sign in again, then try.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (check.kind === "loading") {
    return (
      <p className="text-base text-muted" role="status">
        Checking your account…
      </p>
    );
  }

  if (check.kind === "error") {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice kind="error" blocking>
          We couldn&rsquo;t check your account. Nothing was deleted.
        </InlineNotice>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  if (check.kind === "blocked") {
    const list = check.names.join(", ");
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice kind="info" title="Delete your business first">
          You&rsquo;re the only owner of <span className="font-semibold">{list}</span>.
          Deleting your account would leave {check.names.length === 1 ? "it" : "them"} with
          nobody to run or close {check.names.length === 1 ? "it" : "them"}. Delete the
          business first. When it was your last one, your account is deleted with it.
        </InlineNotice>
        <Button variant="secondary" className="text-danger" asChild>
          <Link href="/settings/delete">Delete my business</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/settings">Keep my account</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <InlineNotice kind="error" title="This cannot be undone.">
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Your sign-in is deleted. You won&rsquo;t be able to sign in with it again.</li>
          <li>You&rsquo;re removed from every business you were part of.</li>
          <li>
            Those businesses keep their ratings and Tags. Notes you wrote stay, marked
            &ldquo;Former team member&rdquo;.
          </li>
        </ul>
      </InlineNotice>

      <div>
        <label htmlFor={fieldId} className="mb-2 block text-base font-medium text-ink">
          Type <span className="font-semibold">delete</span> to confirm
        </label>
        <Input
          id={fieldId}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            if (error === "Type delete to confirm.") setError(null);
          }}
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
        {uncertain ? (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload to check
          </Button>
        ) : (
          <Button variant="destructive" loading={busy} loadingLabel="Deleting…" onClick={remove}>
            Delete my account
          </Button>
        )}
        <Button variant="secondary" asChild>
          <Link href="/settings">Keep my account</Link>
        </Button>
      </div>
    </div>
  );
}
