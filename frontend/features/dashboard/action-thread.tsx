"use client";

import { Lock, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { OutcomeCheckNotice } from "@/components/ui/outcome-check-notice";
import { Textarea } from "@/components/ui/textarea";
import type { ActionNote } from "@/lib/server/owner-data";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";
import { useOutcomeCheck } from "@/lib/recovery/use-outcome-check";
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
  timeZone,
}: {
  responseId: string;
  actions: ActionNote[];
  /** The business's, so "Yesterday" is the business's yesterday. */
  timeZone: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  /** When a note last saved: a second tap right after is not an empty note. */
  const savedAt = useRef(0);
  /** The note on its way, and the notes there before it. */
  const intent = useRef<{ text: string; ids: Set<string> } | null>(null);
  const check = useOutcomeCheck({
    onDone: () => {
      intent.current = null;
      setBody("");
      setError(null);
      router.refresh();
    },
    onNotDone: () => {
      intent.current = null;
      setError("That note didn’t save. Your text is still here. Try again.");
    },
    onExpired: (message) => {
      intent.current = null;
      setError(message);
    },
  });

  // Typed and not saved, or on its way: leaving would lose it, so the
  // browser asks first, as the customer page editor does.
  const unsaved = body.trim().length > 0 || busy || check.pending;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  /** Is the note in the thread now? A read, so nothing is saved twice. */
  async function isSaved(signal: AbortSignal): Promise<boolean> {
    const wanted = intent.current;
    if (!wanted) return false;
    const response = await ownerFetch(
      `/api/v1/customer-responses/${responseId}`,
      { signal },
    );
    if (!response.ok) throw new Error("No answer yet.");
    const { data } = (await response.json()) as {
      data: { notes?: Array<{ noteId: string; body: string }> };
    };
    return (data.notes ?? []).some(
      (note) => note.body === wanted.text && !wanted.ids.has(note.noteId),
    );
  }

  const canSubmit = body.trim().length > 0 && !busy && !check.pending;

  async function add() {
    // Never a dead button: an empty note says what is missing. Not right
    // after a save, though: that is a double tap, and the note is saved.
    if (body.trim().length === 0 && !busy && !check.pending) {
      if (Date.now() - savedAt.current < 2_000) return;
      setError("Write what you did first, then save it.");
      return;
    }
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    intent.current = {
      text: body.trim(),
      ids: new Set(actions.map((action) => action.noteId)),
    };
    try {
      const response = await ownerFetch(
        `/api/v1/customer-responses/${responseId}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: body.trim() }),
        },
      );
      if (!response.ok) {
        // A server error may have come after the note was kept: find out.
        if (response.status >= 500) {
          check.start(isSaved, { serverAnswered: true });
          return;
        }
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        intent.current = null;
        setError(
          payload?.error?.message ??
            "Could not save that. Your text is still here.",
        );
        return;
      }
      setBody("");
      savedAt.current = Date.now();
      intent.current = null;
      router.refresh();
    } catch (caught) {
      if (caught instanceof SessionExpiredError) {
        intent.current = null;
        setError(caught.message);
        return;
      }
      // The answer was lost on the way back. Look rather than ask.
      check.start(isSaved);
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
                  {relativeDay(action.createdAt, timeZone)}
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
      <OutcomeCheckNotice check={check} className="mb-3" />
      <Textarea
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          if (error) setError(null);
        }}
        disabled={busy || check.pending}
        rows={3}
        maxLength={2000}
        aria-label="Write what you did about this"
        placeholder="Add a note for your team…"
      />

      {/* Secondary: "Mark as sorted" above is this screen's one black button. */}
      <Button
        variant="secondary"
        className="mt-3 sm:w-auto"
        disabled={check.pending}
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
