"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { CustomerPicker, type PickerCustomer } from "@/features/dashboard/customer-picker";
import { notify } from "@/components/ui/toast";
import {
  CONSENT_ATTESTATION_VERSION,
  CONSENT_METHODS,
  CONSENT_METHOD_IDS,
  DEFAULT_TEXT_REQUEST_TEMPLATE_ID,
  TEXT_REQUEST_TEMPLATES,
  TEXT_REQUEST_TEMPLATE_IDS,
  type ConsentMethod,
  type TextRequestTemplateId,
} from "@/lib/sms/text-request-templates";
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
   * Customers brought in through Connections, for owners and admins. Empty
   * when there are none; null when they couldn't be loaded, which is said
   * rather than shown as an empty list.
   */
  customers?: readonly PickerCustomer[] | null;
}

interface Eligibility {
  allowed: boolean;
  reason: string | null;
  message: string | null;
}

interface Preview {
  body: string;
  segments: number;
  encoding: string;
  unitCount: number;
  recipientLastFour: string;
  eligibility: Eligibility;
  consentStatement: string;
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
 *
 * The owner picks one of the approved messages; the server adds the business
 * name in front and "Reply STOP to opt out." at the end, and the preview shows
 * that exact text. Sending never records consent. A number with no recorded
 * agreement is shown as such, and the owner can confirm, separately and
 * explicitly, how that customer agreed.
 */
export function TextRequestComposer({ balance, tags, recent, customers = [] }: TextRequestComposerProps) {
  const router = useRouter();
  const hasCustomers = customers !== null && customers.length > 0;
  const [mode, setMode] = useState<"customer" | "number">(hasCustomers ? "customer" : "number");
  const [customer, setCustomer] = useState<PickerCustomer | null>(null);
  const [phone, setPhone] = useState("");
  const [standId, setStandId] = useState(tags[0]?.standId ?? "");
  const [templateId, setTemplateId] = useState<TextRequestTemplateId>(
    DEFAULT_TEXT_REQUEST_TEMPLATE_ID,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [consentMethod, setConsentMethod] = useState<ConsentMethod | "">("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
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

  // Exactly one of the two goes to the server: a chosen customer (whose number
  // the server looks up) or the number typed here.
  function recipient(): { customerId: string } | { phone: string } {
    return mode === "customer" && customer
      ? { customerId: customer.customerId }
      : { phone: phone.trim() };
  }

  const hasRecipient = mode === "customer" ? customer !== null : phone.trim().length >= 3;

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/v1/text-requests/preview", {
        ...recipient(),
        standId,
        templateId,
      });

      if (!response.ok) {
        setPreview(null);
        setError(await readError(response));
        return;
      }

      const payload = (await response.json()) as { data: Preview };
      setPreview(payload.data);
      setConsentMethod("");
      setConsentConfirmed(false);
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
        ...recipient(),
        standId,
        templateId,
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      setPhone("");
      setCustomer(null);
      setPreview(null);
      notify.success("Queued", "We will send it and show the result here.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function recordConsent() {
    if (!consentMethod || !consentConfirmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/v1/text-requests/consent", {
        ...recipient(),
        standId,
        method: consentMethod,
        wordingVersion: CONSENT_ATTESTATION_VERSION,
        confirmed: true,
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      const payload = (await response.json()) as { data: { eligibility: Eligibility } };
      setPreview((current) =>
        current ? { ...current, eligibility: payload.data.eligibility } : current,
      );
      notify.success("Saved", "Their agreement is recorded.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Anything that changes who gets the text, or what it says, needs a fresh
  // preview before it can be sent.
  function clearPreview() {
    setPreview(null);
    setConsentMethod("");
    setConsentConfirmed(false);
  }

  const canSend =
    preview !== null && preview.eligibility.allowed && standId !== "" && balance.total > 0;
  const needsConsent =
    preview !== null && !preview.eligibility.allowed && preview.eligibility.reason === "no_consent";

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

        {tags.length === 0 ? (
          <InlineNotice kind="info">
            <p>Create a Tag first — the message carries its link.</p>
          </InlineNotice>
        ) : (
          <>
            {customers === null ? (
              <InlineNotice kind="info">
                <p>Your customers couldn&rsquo;t be loaded. You can still type a number, or reload to try again.</p>
              </InlineNotice>
            ) : null}

            {mode === "customer" && hasCustomers ? (
              <CustomerPicker
                customers={customers ?? []}
                selected={customer}
                onSelect={(next) => {
                  setCustomer(next);
                  clearPreview();
                }}
              />
            ) : (
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Mobile number
                <input
                  className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    clearPreview();
                  }}
                  placeholder="+1 555 123 4567"
                />
              </label>
            )}

            {hasCustomers ? (
              <button
                type="button"
                className="-mt-2 self-start text-sm font-medium text-ink underline underline-offset-4 hover:no-underline"
                onClick={() => {
                  setMode(mode === "customer" ? "number" : "customer");
                  setCustomer(null);
                  setPhone("");
                  clearPreview();
                }}
              >
                {mode === "customer" ? "Type a number instead" : "Choose from your customers"}
              </button>
            ) : null}

            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Which Tag
              <select
                className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
                value={standId}
                onChange={(event) => {
                  setStandId(event.target.value);
                  clearPreview();
                }}
              >
                {tags.map((tag) => (
                  <option key={tag.standId} value={tag.standId}>
                    {tag.locationName ? `${tag.label} — ${tag.locationName}` : tag.label}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-muted">Message</legend>
              {TEXT_REQUEST_TEMPLATE_IDS.map((id) => (
                <label
                  key={id}
                  className="flex min-h-14 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border bg-canvas p-4 text-base text-ink"
                >
                  <input
                    type="radio"
                    name="text-request-template"
                    className="mt-1"
                    value={id}
                    checked={templateId === id}
                    onChange={() => {
                      setTemplateId(id);
                      clearPreview();
                    }}
                  />
                  <span>{TEXT_REQUEST_TEMPLATES[id].replace("{{link}}", "[your Tag link]")}</span>
                </label>
              ))}
              <span className="text-xs text-muted">
                Your business name goes in front, and every text ends with &ldquo;Reply STOP to
                opt out.&rdquo;
              </span>
            </fieldset>

            {preview ? (
              <section
                className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border bg-canvas p-4"
                aria-labelledby="preview-heading"
              >
                <h3 id="preview-heading" className="text-sm font-medium text-muted">
                  What ••• {preview.recipientLastFour} will get
                </h3>
                <p className="whitespace-pre-wrap break-words text-base text-ink">
                  {preview.body}
                </p>
                <p className="text-sm text-muted">
                  {preview.segments} {preview.segments === 1 ? "message" : "messages"} will be
                  billed ({preview.unitCount} characters, {preview.encoding.toUpperCase()}).
                </p>
              </section>
            ) : null}

            {preview && !preview.eligibility.allowed && !needsConsent ? (
              <InlineNotice kind="error" title="You can't text this number">
                <p>{preview.eligibility.message}</p>
              </InlineNotice>
            ) : null}

            {needsConsent && preview ? (
              <section
                className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border bg-surface p-4"
                aria-labelledby="consent-heading"
              >
                <h3 id="consent-heading" className="text-base font-semibold text-ink">
                  Did this customer agree to a text?
                </h3>
                <p className="text-sm text-muted">
                  {preview.eligibility.message} Only continue if they said yes.
                </p>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-muted">How they agreed</legend>
                  {CONSENT_METHOD_IDS.map((id) => (
                    <label key={id} className="flex min-h-11 items-center gap-3 text-base text-ink">
                      <input
                        type="radio"
                        name="consent-method"
                        value={id}
                        checked={consentMethod === id}
                        onChange={() => setConsentMethod(id)}
                      />
                      {CONSENT_METHODS[id]}
                    </label>
                  ))}
                </fieldset>
                <label className="flex items-start gap-3 text-base text-ink">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={consentConfirmed}
                    onChange={(event) => setConsentConfirmed(event.target.checked)}
                  />
                  <span>{preview.consentStatement}</span>
                </label>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void recordConsent()}
                    loading={busy}
                    loadingLabel="Saving…"
                    disabled={!consentMethod || !consentConfirmed}
                  >
                    Save their agreement
                  </Button>
                </div>
              </section>
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
                disabled={busy || !hasRecipient || standId === ""}
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
