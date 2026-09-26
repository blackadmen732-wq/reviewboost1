"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { notify } from "@/components/ui/toast";
import { ownerOrAdmin } from "@/lib/owner/permissions";
import {
  DEFAULT_TEXT_REQUEST_WORDS,
  previewParts,
  templateFromOwnerWords,
} from "@/lib/sms/text-request-message";
import { relativeDay } from "@/lib/utils/relative-day";
import { cn } from "@/lib/utils/cn";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface Balance {
  monthly: number;
  purchased: number;
  total: number;
}

interface TagOption {
  standId: string;
  label: string;
  locationName: string | null;
}

interface RecentRequest {
  id: string;
  status: string;
  segments: number;
  recipientLastFour: string | null;
  createdAt: string;
}

interface TextRequestComposerProps {
  balance: Balance;
  tags: readonly TagOption[];
  recent: readonly RecentRequest[];
  /**
   * Sending, previewing and cancelling are owner/admin at the API. Everyone
   * else sees the balance and the recent list, and no form that would 403.
   */
  canSendRequests: boolean;
}

interface Preview {
  segments: number;
  encoding: string;
  unitCount: number;
}

/**
 * Compose one Text Request.
 *
 * The balance shown is the ledger's, split by source, because "you have 40
 * left" and "34 of those disappear on the 1st" are different facts an owner
 * needs to plan around. Nothing here knows what a plan includes.
 *
 * The segment count comes from the server too. Counting characters in the
 * browser and dividing by 160 is wrong for any message containing an emoji,
 * a curly quote, or an accented name — and the number it produces is what the
 * business is billed against.
 */
export function TextRequestComposer({
  balance,
  tags,
  recent,
  canSendRequests,
}: TextRequestComposerProps) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [standId, setStandId] = useState(tags[0]?.standId ?? "");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authorizedFetch(path: string, body: unknown): Promise<Response> {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) throw new Error("Your session expired. Please sign in again.");

    return fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
  }

  async function readError(response: Response): Promise<string> {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string; details?: Array<{ message?: string }> };
    } | null;
    return (
      payload?.error?.details?.[0]?.message ??
      payload?.error?.message ??
      "That did not go through. Please try again."
    );
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/v1/text-requests/preview", {
        phone: phone.trim(),
        standId,
        ...(templateFromOwnerWords(message) ? { messageTemplate: templateFromOwnerWords(message) } : {}),
      });

      if (!response.ok) {
        setPreview(null);
        setError(await readError(response));
        return;
      }

      const payload = (await response.json()) as {
        data: { segments: number; encoding: string; unitCount: number };
      };
      setPreview(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/v1/text-requests", {
        phone: phone.trim(),
        standId,
        ...(templateFromOwnerWords(message) ? { messageTemplate: templateFromOwnerWords(message) } : {}),
        consent: { source: "owner_import" },
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      setPhone("");
      setPreview(null);
      notify.success("Queued", "We will send it and show the result here.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const canSend = phone.trim().length > 2 && standId !== "" && balance.total > 0;
  const chosenTag = tags.find((tag) => tag.standId === standId) ?? null;

  return (
    <div className="flex flex-col gap-10">
      <BalanceLine balance={balance} />

      {!canSendRequests ? (
        <p className="text-base text-muted" data-text-request-access="read-only">
          {ownerOrAdmin("send Text Requests")}
        </p>
      ) : tags.length === 0 ? (
        <InlineNotice kind="info">
          <p>Create a Tag first — the message carries its link.</p>
        </InlineNotice>
      ) : (
        <section className="flex flex-col gap-5" aria-label="Send a Text Request">
          <Field label="Customer's mobile number">
            {(id) => (
              <input
                id={id}
                className={fieldClass}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setPreview(null);
                }}
                placeholder="(555) 123-4567"
              />
            )}
          </Field>

          {tags.length > 1 ? (
            <Field label="Send the link to">
              {(id) => (
                <select
                  id={id}
                  className={fieldClass}
                  value={standId}
                  onChange={(event) => {
                    setStandId(event.target.value);
                    setPreview(null);
                  }}
                >
                  {tags.map((tag) => (
                    <option key={tag.standId} value={tag.standId}>
                      {tag.locationName ? `${tag.label} — ${tag.locationName}` : tag.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}

          <Field label="Message" hint="Optional. Your Tag's link is added at the end.">
            {(id, hintId) => (
              <textarea
                id={id}
                aria-describedby={hintId}
                className={cn(fieldClass, "min-h-24 py-3.5 leading-relaxed")}
                value={message}
                maxLength={420}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setPreview(null);
                }}
                placeholder={DEFAULT_TEXT_REQUEST_WORDS}
              />
            )}
          </Field>

          <MessagePreview words={message} tagLabel={chosenTag?.label ?? "your Tag"} />

          {error ? (
            <div className="animate-fade-in">
              <InlineNotice kind="error" title="That did not go through" blocking>
                <p>{error}</p>
              </InlineNotice>
            </div>
          ) : null}

          {balance.total === 0 ? (
            <InlineNotice kind="info">
              <p>You have no texts left. Buy more or wait for your next billing date.</p>
            </InlineNotice>
          ) : null}

          <div className="flex flex-col gap-3">
            <Button
              type="button"
              variant="action"
              size="lg"
              onClick={() => void send()}
              loading={busy}
              loadingLabel="Sending…"
              disabled={!canSend}
            >
              Send text request
            </Button>
            {/* The exact count depends on the real link, which only the server
                builds, so it is a server check rather than a guess here. */}
            {preview ? (
              <p className="animate-fade-in text-center text-sm text-muted" role="status">
                {preview.segments === 1
                  ? "This uses 1 text."
                  : `This uses ${preview.segments} texts — shorten the message to use fewer.`}
              </p>
            ) : (
              <button
                type="button"
                className="mx-auto min-h-11 rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
                onClick={() => void runPreview()}
                disabled={busy || phone.trim().length < 3 || standId === ""}
              >
                How many texts will this use?
              </button>
            )}
          </div>
        </section>
      )}

      <RecentList recent={recent} />
    </div>
  );
}

const fieldClass =
  "min-h-14 w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 text-base text-ink placeholder:text-muted transition-colors focus:border-[color:var(--rb-brand)] focus:outline-none focus:ring-4 focus:ring-[color:var(--rb-focus-soft)]";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string, hintId: string | undefined) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children(id, hintId)}
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The text as the customer's phone will show it. The words are exact; the
 * link is the Tag's real ReviewBoost link, which the server builds, so it is
 * shown as the link rather than as a made-up address.
 */
function MessagePreview({ words, tagLabel }: { words: string; tagLabel: string }) {
  const { before, after } = previewParts(words);
  return (
    <div aria-label="Message preview" role="group">
      <p className="mb-2 text-sm font-medium text-muted">What they&apos;ll get</p>
      <div className="max-w-[20rem] rounded-[20px] rounded-bl-[6px] bg-quiet px-4 py-3 text-[0.9375rem] leading-relaxed text-ink">
        {before}{" "}
        <span className="break-words font-medium text-brand-text underline decoration-1 underline-offset-2">
          link to {tagLabel}
        </span>
        {after ? ` ${after}` : null}
      </div>
    </div>
  );
}

/**
 * One line, not an accounting lesson. The split by source only appears when
 * there is something purchased to split out.
 */
function BalanceLine({ balance }: { balance: Balance }) {
  return (
    <section aria-label="Texts left">
      <p className="flex items-baseline gap-2">
        <span className="text-[2rem] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums">
          {balance.total.toLocaleString()}
        </span>
        <span className="text-base text-muted">{balance.total === 1 ? "text left" : "texts left"}</span>
      </p>
      {balance.purchased > 0 ? (
        <p className="mt-2 text-sm text-muted">
          {balance.monthly.toLocaleString()} from this month&apos;s plan, used first ·{" "}
          {balance.purchased.toLocaleString()} purchased, kept until used
        </p>
      ) : null}
    </section>
  );
}

const STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" | "off" }> = {
  scheduled: { label: "Scheduled", tone: "wait" },
  queued: { label: "Sending", tone: "wait" },
  sending: { label: "Sending", tone: "wait" },
  submitted: { label: "Sent", tone: "wait" },
  provider_unknown: { label: "Sent", tone: "wait" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Not delivered", tone: "bad" },
  suppressed: { label: "Not sent — number opted out or blocked", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
};

/**
 * What changed in the list since it was first drawn. A request just sent
 * arrives as a new row, which settles in (opacity and 4px, 200ms); a status
 * that moved on, Sending to Delivered, fades to the new one. Rows that were
 * already there when the page opened are simply there. Calm on purpose: a
 * text going out is routine, not a moment.
 */
function useListChanges(recent: readonly RecentRequest[]) {
  // The list as it was before the latest change; null until it first changes.
  const [state, setState] = useState<{ list: readonly RecentRequest[]; before: Map<string, string> | null }>({
    list: recent,
    before: null,
  });
  if (state.list !== recent) {
    setState({ list: recent, before: new Map(state.list.map((item) => [item.id, item.status])) });
  }
  const before = state.before;
  return {
    isNew: (item: RecentRequest) => before !== null && !before.has(item.id),
    statusMoved: (item: RecentRequest) =>
      before !== null && before.has(item.id) && before.get(item.id) !== item.status,
  };
}

function RecentList({ recent }: { recent: readonly RecentRequest[] }) {
  const { isNew, statusMoved } = useListChanges(recent);
  return (
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="mb-2 text-sm font-medium text-muted">
        Recent
      </h2>
      {recent.length === 0 ? (
        <p className="text-base text-muted">Nothing sent yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {recent.map((item) => {
            const status = STATUS[item.status] ?? { label: item.status, tone: "wait" as const };
            return (
              <li
                key={item.id}
                className={cn("flex min-h-14 items-center gap-3 py-3", isNew(item) && "animate-row-in")}
              >
                <span className="text-base tabular-nums text-ink">
                  ••• {item.recipientLastFour ?? "????"}
                </span>
                <span className="text-sm text-muted">{relativeDay(item.createdAt)}</span>
                <span
                  key={item.status}
                  className={cn(
                    "ml-auto inline-flex items-center gap-1.5 text-sm",
                    statusMoved(item) && "animate-fade-in",
                    status.tone === "bad" ? "font-medium text-danger" : "text-muted",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 rounded-full",
                      status.tone === "ok" && "bg-brand",
                      status.tone === "wait" && "bg-[color:var(--rb-border-strong)]",
                      status.tone === "bad" && "bg-danger",
                      status.tone === "off" && "border border-[color:var(--rb-border-strong)]",
                    )}
                  />
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
