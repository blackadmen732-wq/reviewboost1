"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { OutcomeCheckNotice } from "@/components/ui/outcome-check-notice";
import { RetryNotice } from "@/components/ui/retry-notice";
import { withReadDeadline, withWriteDeadline } from "@/lib/api/read-deadline";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";
import { useOutcomeCheck } from "@/lib/recovery/use-outcome-check";
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
  const outcome = useOutcomeCheck({
    onDone: () => void goodbye(),
    onNotDone: () => setError("Your account was not deleted. Nothing changed. Try again."),
    onExpired: setError,
  });

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

  async function goodbye() {
    try {
      await supabaseBrowser().auth.signOut();
    } catch {
      /* The deleted login is unusable server-side. */
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/goodbye");
  }

  /** Is the login gone? A deleted one is refused (401) where it used to be read. */
  function isGone(token: string) {
    return async (signal: AbortSignal): Promise<boolean> => {
      const response = await fetch("/api/v1/account/personal-deletion", {
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) return true;
      if (!response.ok) throw new Error("No answer yet.");
      return false;
    };
  }

  async function remove() {
    if (busy || outcome.pending) return;
    if (typed.trim().toLowerCase() !== WORD) {
      setError("Type delete to confirm.");
      return;
    }
    setBusy(true);
    setError(null);

    let token: string | null = null;
    try {
      token = await accessToken();
      if (!token) {
        setError("Your session expired. Sign in again, then delete.");
        return;
      }
      const sent = token;
      const response = await withWriteDeadline(
        async (signal) =>
          await fetch("/api/v1/account/personal-deletion", {
            signal,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sent}`,
            },
            body: JSON.stringify({ confirmation: typed.trim() }),
          }),
      );
      if (!response.ok) {
        // A server error can come after the login was deleted: find out.
        if (response.status >= 500) {
          outcome.start(isGone(sent), { serverAnswered: true });
          return;
        }
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
        setError(body?.error?.message ?? "Your account was not deleted. Try again shortly.");
        return;
      }
      await goodbye();
    } catch {
      if (!token) {
        setError("Could not verify your session. Sign in again, then try.");
        return;
      }
      // A lost response: the login may or may not be gone. Ask the server,
      // which refuses a deleted login, rather than ask the person to reload.
      outcome.start(isGone(token));
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
    return <AccountCheckFailed failure={check} onRetry={retry} />;
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
          disabled={busy || outcome.pending}
          {...(error ? { "aria-invalid": true, "aria-describedby": errorId } : {})}
        />
      </div>

      {error ? (
        <InlineNotice id={errorId} kind="error" blocking>
          {error}
        </InlineNotice>
      ) : null}

      <OutcomeCheckNotice check={outcome} />

      <div className="flex flex-col gap-3">
        <Button
          variant="destructive"
          loading={busy}
          loadingLabel="Deleting…"
          disabled={outcome.pending}
          onClick={remove}
        >
          Delete my account
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/settings">Keep my account</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The first check could not reach the server. Nothing was deleted, and it
 * tries again by itself (3 s, 10 s, 30 s, or when the connection is back).
 */
function AccountCheckFailed({ failure, onRetry }: { failure: Check; onRetry: () => void }) {
  const retry = useAutoRetry({ key: "personal-deletion-check", failure, onRetry });
  return (
    <InlineNotice kind="error" blocking>
      <RetryNotice retry={retry} what="Couldn’t check your account. Nothing was deleted." />
    </InlineNotice>
  );
}
