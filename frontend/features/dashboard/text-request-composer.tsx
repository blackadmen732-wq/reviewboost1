"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { notify } from "@/components/ui/toast";
import { ownerOrAdmin } from "@/lib/owner/permissions";
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
        ...(message.trim() ? { messageTemplate: message.trim() } : {}),
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
        ...(message.trim() ? { messageTemplate: message.trim() } : {}),
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

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
        aria-labelledby="balance-heading"
      >
        <h2 id="balance-heading" className="text-sm font-medium text-muted">
          Messages you can send
        </h2>
        <p className="mt-1 text-3xl font-semibold tracking-[-0.02em] text-ink">
          {balance.total}
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <div className="flex gap-2">
            <dt>Included this month</dt>
            <dd className="font-medium text-ink">{balance.monthly}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Purchased</dt>
            <dd className="font-medium text-ink">{balance.purchased}</dd>
          </div>
        </dl>
        {balance.monthly > 0 ? (
          <p className="mt-2 text-sm text-muted">
            Included messages are used first and do not carry over. Purchased ones stay
            until you use them.
          </p>
        ) : null}
      </section>

      <section
        className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4"
        aria-labelledby="compose-heading"
      >
        <h2 id="compose-heading" className="text-base font-semibold text-ink">
          Send a request
        </h2>

        {!canSendRequests ? (
          <p className="text-base text-muted" data-text-request-access="read-only">
            {ownerOrAdmin("send Text Requests")}
          </p>
        ) : tags.length === 0 ? (
          <InlineNotice kind="info">
            <p>Create a Tag first — the message carries its link.</p>
          </InlineNotice>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Mobile number
              <input
                className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+1 555 123 4567"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Which Tag
              <select
                className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
                value={standId}
                onChange={(event) => setStandId(event.target.value)}
              >
                {tags.map((tag) => (
                  <option key={tag.standId} value={tag.standId}>
                    {tag.locationName ? `${tag.label} — ${tag.locationName}` : tag.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Message (optional)
              <textarea
                className="min-h-24 rounded-[var(--radius-control)] border border-border bg-canvas p-4 text-base text-ink"
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setPreview(null);
                }}
                placeholder="How was your visit? Tap here to leave a review: {{link}}"
              />
              <span className="text-xs text-muted">
                Leave it empty to use the default. Include {"{{link}}"} where the Tag link
                should go.
              </span>
            </label>

            {preview ? (
              <InlineNotice kind="info">
                {/* Message count only. The server still computes exact segments —
                    including the GSM-7/UCS-2 split that makes one emoji halve the
                    limit — and the ledger still bills on that. An owner cannot act
                    on "UCS-2" and should not have to learn what it means. */}
                <p>
                  {preview.segments === 1
                    ? "1 message will be billed."
                    : `${preview.segments} messages will be billed.`}
                </p>
              </InlineNotice>
            ) : null}

            {error ? (
              <InlineNotice kind="error" title="That did not go through" blocking>
                <p>{error}</p>
              </InlineNotice>
            ) : null}

            {balance.total === 0 ? (
              <InlineNotice kind="info">
                <p>You have no messages left. Buy more or wait for your next billing date.</p>
              </InlineNotice>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void runPreview()}
                disabled={busy || phone.trim().length < 3 || standId === ""}
              >
                Preview
              </Button>
              <Button
                type="button"
                onClick={() => void send()}
                loading={busy}
                loadingLabel="Sending…"
                disabled={!canSend}
              >
                Send
              </Button>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-3 text-base font-semibold text-ink">
          Recent
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-border bg-surface px-4 py-3"
              >
                <span className="text-sm text-ink">
                  ••• {item.recipientLastFour ?? "????"}
                </span>
                <span className="text-sm text-muted">
                  {item.segments} {item.segments === 1 ? "message" : "messages"} · {item.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
