"use client";

import { Lock, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionNote } from "@/lib/server/owner-data";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";
import { relativeDay } from "@/lib/utils/relative-day";

/**
 * What the business did about this.
 *
 * THIS IS NOT SENT TO THE CUSTOMER, AND THE SCREEN SAYS SO
 * -------------------------------------------------------
 * There is nobody to send it to. The public flow asks for no email, no phone and
 * no name, so nothing in the system can be turned into a delivery address — and
 * that anonymity is exactly why people write what actually happened instead of
 * writing nothing.
 *
 * Every owner arriving at a text box under a complaint will assume it replies to
 * the customer, because every other product works that way. Letting them find
 * out otherwise would be a genuine betrayal — they would write an apology to
 * someone who never receives it. So the notice is stated before the box, not
 * after it, and not in small print.
 *
 * What the thread is good for is the thing that actually changes a business:
 * "called the supplier", "spoke to Amara", "refunded them". Three weeks later,
 * when the same complaint arrives again, that history is the whole point.
 *
 * Append-only, and the database enforces it — no UPDATE grant exists on this
 * table. A record that can be quietly rewritten is not a record.
 */
export function ActionThread({
  responseId,
  actions,
}: {
  responseId: string;
  actions: ActionNote[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [checking, setChecking] = useState(false);
  const intent = useRef<{ text: string; ids: Set<string> } | null>(null);
  const previousActions = useRef(actions);
  useEffect(() => {
    if (!uncertain || !checking || actions === previousActions.current) return;
    const saved =
      intent.current &&
      actions.some(
        (action) =>
          action.body === intent.current?.text &&
          !intent.current.ids.has(action.noteId),
      );
    if (saved) {
      setBody("");
      setError(null);
    } else
      setError(
        "The refreshed thread does not show this note. Your text is still here; you can try saving again.",
      );
    setUncertain(false);
    setChecking(false);
    intent.current = null;
  }, [actions, checking, uncertain]);
  useEffect(() => {
    if (!checking) return;
    const timer = setTimeout(() => {
      setChecking(false);
      setError(
        "Could not check the thread. Your text is still here. Try checking again before saving.",
      );
    }, 20_000);
    return () => clearTimeout(timer);
  }, [checking]);
  const canSubmit = body.trim().length > 0 && !busy && !uncertain;

  async function add() {
    // Never a dead button: an empty note says what is missing.
    if (body.trim().length === 0 && !busy && !uncertain) {
      setError("Write what you did first, then save it.");
      return;
    }
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    let submitted = false;
    try {
      intent.current = {
        text: body.trim(),
        ids: new Set(actions.map((action) => action.noteId)),
      };
      submitted = true;
      const response = await ownerFetch(
        `/api/v1/customer-responses/${responseId}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: body.trim() }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        if (response.status >= 500) setUncertain(true);
        setError(
          payload?.error?.message ??
            "Could not save that. Your text is still here.",
        );
        return;
      }
      setBody("");
      intent.current = null;
      router.refresh();
    } catch (caught) {
      setUncertain(submitted && !(caught instanceof SessionExpiredError));
      setError(
        caught instanceof SessionExpiredError
          ? caught.message
          : "Could not confirm saving. Your text is still here. Check the saved notes before sending it again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="mb-1 text-lg font-semibold text-ink">What we did</h2>

      <p className="mb-4 flex items-start gap-2 text-sm leading-relaxed text-muted">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Only your team sees this. The customer stays anonymous, so there is no
          way to write back to them.
        </span>
      </p>

      {actions.length > 0 ? (
        <ol className="mb-6 divide-y divide-border border-y border-border">
          {actions.map((action) => (
            <li key={action.noteId} className="py-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {action.authorName}
                </span>
                <time
                  dateTime={action.createdAt}
                  className="shrink-0 text-sm text-muted"
                >
                  {relativeDay(action.createdAt)}
                </time>
              </div>
              <p className="whitespace-pre-wrap text-base leading-relaxed text-ink">
                {action.body}
              </p>
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <Button
          variant="secondary"
          className="mb-3"
          loading={checking}
          loadingLabel="Checking…"
          onClick={() => {
            previousActions.current = actions;
            setChecking(true);
            router.refresh();
          }}
        >
          Check saved notes
        </Button>
      ) : null}
      <Textarea
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          if (error && !uncertain) setError(null);
        }}
        disabled={busy}
        rows={3}
        maxLength={2000}
        aria-label="Write what you did about this"
        placeholder="Checked with the team and agreed what to change…"
      />

      {/* Secondary: "Mark as sorted" above is this screen's one black button. */}
      <Button
        variant="secondary"
        className="mt-3 sm:w-auto"
        disabled={uncertain}
        loading={busy}
        loadingLabel="Saving…"
        onClick={() => void add()}
      >
        <Send className="size-5" aria-hidden="true" />
        Save note
      </Button>
    </section>
  );
}
