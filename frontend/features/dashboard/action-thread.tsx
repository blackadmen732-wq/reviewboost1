"use client";

import { Lock, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import type { ActionNote } from "@/lib/server/owner-data";
import { supabaseBrowser } from "@/lib/supabase/browser";
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

  const canSubmit = body.trim().length > 0 && !busy;

  async function add() {
    if (!canSubmit) return;
    setBusy(true);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    const response = await fetch(`/api/v1/customer-responses/${responseId}/notes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ body: body.trim() }),
    });

    setBusy(false);

    if (!response.ok) {
      // The text stays in the box. Losing what someone just typed because of a
      // dropped connection is the fastest way to lose their trust in the app.
      notify.error("Could not save that", "Your note is still here — try again.");
      return;
    }

    setBody("");
    router.refresh();
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
        <ol className="mb-4 flex flex-col gap-3">
          {actions.map((action) => (
            <li
              key={action.noteId}
              className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
                  {action.authorName.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {action.authorName}
                </span>
                <time dateTime={action.createdAt} className="shrink-0 text-sm text-muted">
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

      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={busy}
        rows={3}
        maxLength={2000}
        aria-label="Write what you did about this"
        placeholder="Called them back and said sorry…"
      />

      <Button className="mt-3" disabled={!canSubmit} loading={busy} loadingLabel="Saving…" onClick={() => void add()}>
        <Send className="size-5" aria-hidden="true" />
        Save note
      </Button>
    </section>
  );
}
