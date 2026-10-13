"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { notify } from "@/components/ui/toast";
import { MessagePhone } from "@/features/text-requests/message-phone";
import {
  compareCustomers,
  textRequestStatus,
  type CustomerConsentState,
} from "@/lib/owner/customers";
import { ownerOrAdmin } from "@/lib/owner/permissions";
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
import { cn } from "@/lib/utils/cn";
import { relativeDay } from "@/lib/utils/relative-day";

interface Balance {
  monthly: number;
  purchased: number;
  total: number;
}

interface TagOption {
  standId: string;
  label: string;
  locationName: string | null;
  locationId?: string | null;
}

interface RecentRequest {
  id: string;
  status: string;
  segments: number;
  recipientLastFour: string | null;
  createdAt: string;
}

export interface SavedCustomer {
  id: string;
  name: string | null;
  lastFour: string;
  /** What the consent ledger says about texting them. */
  agreement: CustomerConsentState;
}

interface TextRequestComposerProps {
  canSendRequests: boolean;
  balance: Balance;
  tags: readonly TagOption[];
  recent: readonly RecentRequest[];
  /**
   * Saved customers, for an owner or admin; empty for anyone else. Null when
   * the list could not be read: said so, never shown as nobody saved.
   */
  customers?: readonly SavedCustomer[] | null;
  /** A customer chosen on the Customers list ("Send a text"). */
  initialCustomerId?: string | null;
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

type Recipient = { customerId: string } | { phone: string };

/**
 * Compose one Text Request.
 *
 * One button at a time. It previews until there is a preview, then sends to the
 * number it previewed, by its last four digits so the owner sees who it goes
 * to. A number with no recorded agreement shows the agreement step instead, and
 * a number that cannot be texted shows why — never a button that will fail.
 * Changing anything about who gets the text, or what it says, goes back to
 * Preview.
 *
 * The balance shown is the ledger's, split by source, because "you have 40
 * left" and "34 of those disappear on the 1st" are different facts an owner
 * needs to plan around. Nothing here knows what a plan includes.
 *
 * The message and its segment count come from the server. Counting characters
 * in the browser and dividing by 160 is wrong for any message containing an
 * emoji, a curly quote, or an accented name — and the number it produces is
 * what the business is billed against. The phone on the right draws only that
 * server text.
 *
 * A saved customer is sent by id: the server reads their number, so the
 * browser never holds it. Sending never records consent. A number with no
 * recorded agreement is shown as such, and the owner can confirm, separately
 * and explicitly, how that customer agreed.
 */
export function TextRequestComposer({
  balance,
  tags,
  recent,
  canSendRequests,
  customers: customersOrNull = [],
  initialCustomerId = null,
}: TextRequestComposerProps) {
  const router = useRouter();
  const customers = customersOrNull ?? [];
  const sorted = [...customers].sort(compareCustomers);
  const startsSaved =
    initialCustomerId !== null && customers.some((customer) => customer.id === initialCustomerId);

  const [mode, setMode] = useState<"saved" | "new">(startsSaved ? "saved" : "new");
  const [customerId, setCustomerId] = useState(startsSaved ? initialCustomerId! : "");
  const [phone, setPhone] = useState("");
  const [saveNew, setSaveNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [standId, setStandId] = useState(tags[0]?.standId ?? "");
  const [templateId, setTemplateId] = useState<TextRequestTemplateId>(DEFAULT_TEXT_REQUEST_TEMPLATE_ID);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [consentMethod, setConsentMethod] = useState<ConsentMethod | "">("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = customers.find((customer) => customer.id === customerId) ?? null;
  const recipient: Recipient | null =
    mode === "saved"
      ? chosen
        ? { customerId: chosen.id }
        : null
      : phone.trim().length >= 3
        ? { phone: phone.trim() }
        : null;

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
    if (!recipient || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/v1/text-requests/preview", {
        ...recipient,
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

  /** After a send to a typed number, keep it if the owner asked. Never blocks the send. */
  async function saveTypedCustomer(sentPhone: string) {
    const tag = tags.find((option) => option.standId === standId);
    try {
      const response = await authorizedFetch("/api/v1/customers", {
        name: newName.trim() || null,
        phone: sentPhone,
        locationId: tag?.locationId ?? null,
      });
      if (response.ok) {
        notify.success("Saved to Customers", "Next time, choose them from your list.");
      } else if (response.status === 409) {
        notify.success("Already in Customers", "That number was saved before.");
      } else {
        notify.error("Sent, but not saved", await readError(response));
      }
    } catch {
      notify.error("Sent, but not saved", "Add them from Customers when you're back online.");
    }
  }

  async function send() {
    if (!canSend || busy || !recipient) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/v1/text-requests", {
        ...recipient,
        standId,
        templateId,
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      const sentPhone = phone.trim();
      const keep = mode === "new" && saveNew;
      setPhone("");
      setNewName("");
      setSaveNew(false);
      setPreview(null);
      notify.success("Queued", "We will send it and show the result here.");
      if (keep) await saveTypedCustomer(sentPhone);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function recordConsent() {
    if (!canSendRequests || busy || !recipient || !consentMethod || !consentConfirmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/v1/text-requests/consent", {
        ...recipient,
        standId,
        method: consentMethod,
        wordingVersion: CONSENT_ATTESTATION_VERSION,
        confirmed: true,
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      const payload = (await response.json()) as {
        data: { eligibility: Eligibility };
      };
      setPreview((current) => (current ? { ...current, eligibility: payload.data.eligibility } : current));
      notify.success("Saved", "Their agreement is recorded.");
      if (mode === "saved") router.refresh();
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
    setError(null);
  }

  const canSend =
    canSendRequests &&
    recipient !== null &&
    preview !== null &&
    preview.eligibility.allowed &&
    standId !== "" &&
    balance.total >= preview.segments;
  const needsConsent =
    preview !== null && !preview.eligibility.allowed && preview.eligibility.reason === "no_consent";
  const blocked = preview !== null && !preview.eligibility.allowed && !needsConsent;
  const short = preview !== null && preview.eligibility.allowed && balance.total < preview.segments;

  const form = (
    <div className="flex min-w-0 flex-col gap-5">
      {customersOrNull === null ? (
        <InlineNotice kind="info">
          <p>Your saved customers couldn&apos;t load just now. You can still type a number.</p>
        </InlineNotice>
      ) : null}
      {customers.length > 0 ? (
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-muted">Who gets it</legend>
          <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] border border-border bg-quiet p-1">
            {(
              [
                ["saved", "Saved customer"],
                ["new", "New number"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-center rounded-[calc(var(--radius-control)-4px)] px-3 text-sm font-medium transition-[background-color,color]",
                  "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[color:var(--rb-focus-soft)]",
                  mode === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                <input
                  type="radio"
                  name="text-request-recipient"
                  className="sr-only"
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                    clearPreview();
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {mode === "saved" && customers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Customer
            <select
              className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
              disabled={busy}
              value={customerId}
              onChange={(event) => {
                setCustomerId(event.target.value);
                clearPreview();
              }}
            >
              <option value="">Choose a customer</option>
              {sorted.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name ?? "No name"} · ••• {customer.lastFour}
                </option>
              ))}
            </select>
          </label>
          {chosen ? <AgreementHint state={chosen.agreement} /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Customer&apos;s mobile number
            <input
              className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              disabled={busy}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                clearPreview();
              }}
              placeholder="+1 555 123 4567"
            />
          </label>
          <label className="flex min-h-11 items-center gap-3 text-base text-ink">
            <input
              type="checkbox"
              className="size-4 accent-action"
              disabled={busy}
              checked={saveNew}
              onChange={(event) => setSaveNew(event.target.checked)}
            />
            Save to Customers after sending
          </label>
          {saveNew ? (
            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Their name (optional)
              <input
                className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
                type="text"
                autoComplete="off"
                maxLength={80}
                disabled={busy}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium text-muted">
        Which Tag
        <select
          className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
          disabled={busy}
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

      <fieldset disabled={busy} className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-muted">Message</legend>
        {TEXT_REQUEST_TEMPLATE_IDS.map((id) => (
          <label
            key={id}
            className={cn(
              "flex min-h-14 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border bg-canvas p-4 text-base text-ink transition-[border-color]",
              templateId === id ? "border-action" : "border-border",
            )}
          >
            <input
              type="radio"
              name="text-request-template"
              className="mt-1 accent-action"
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
          Your business name goes in front, and every text ends with &ldquo;Reply STOP to opt out.&rdquo;
        </span>
      </fieldset>
    </div>
  );

  const phonePreview = (compact: boolean) => (
    <div className="flex flex-col gap-3">
      <MessagePhone
        body={preview?.body ?? null}
        lastFour={preview?.recipientLastFour ?? chosen?.lastFour ?? null}
        compact={compact}
      />
      {preview ? (
        <p className={cn("text-sm text-muted", !compact && "text-center")} data-preview-cost>
          Uses {preview.segments} {preview.segments === 1 ? "credit" : "credits"}. Your balance is {balance.total}.
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <BalanceLine balance={balance} />

      <section className="flex flex-col gap-5" aria-labelledby="compose-heading">
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
            <Link href="/stands" className="mt-2 inline-block text-brand-text underline">
              Go to Tags
            </Link>
          </InlineNotice>
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_17rem] md:items-start">
            <div className="flex min-w-0 flex-col gap-5">
              {form}

              {/* On a phone the preview sits here, once there is one; on a wider
                  screen it stays beside the form the whole time. */}
              {preview ? <div className="md:hidden">{phonePreview(true)}</div> : null}

              {blocked && preview ? (
                <InlineNotice kind="error" title="You can't text this number">
                  <p>{preview.eligibility.message}</p>
                </InlineNotice>
              ) : null}

              {needsConsent && preview ? (
                <section className="flex flex-col gap-3 border-y border-border py-5" aria-labelledby="consent-heading">
                  <h3 id="consent-heading" className="text-base font-semibold text-ink">
                    Did this customer agree to a text?
                  </h3>
                  <p className="text-sm text-muted">{preview.eligibility.message} Only continue if they said yes.</p>
                  <fieldset disabled={busy} className="flex flex-col gap-1">
                    <legend className="mb-1 text-sm font-medium text-muted">How they agreed</legend>
                    {CONSENT_METHOD_IDS.map((id) => (
                      <label key={id} className="flex min-h-11 items-center gap-3 text-base text-ink">
                        <input
                          type="radio"
                          name="consent-method"
                          className="accent-action"
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
                      disabled={busy}
                      className="mt-1 accent-action"
                      checked={consentConfirmed}
                      onChange={(event) => setConsentConfirmed(event.target.checked)}
                    />
                    <span>{preview.consentStatement}</span>
                  </label>
                </section>
              ) : null}

              {error ? (
                <InlineNotice kind="error" title="That did not go through" blocking>
                  <p>{error}</p>
                </InlineNotice>
              ) : null}

              {short ? (
                <InlineNotice kind="info">
                  <p>You need more credits to send this request.</p>
                  <Link href="/settings/billing" className="mt-2 inline-block text-brand-text underline">
                    View billing and credits
                  </Link>
                </InlineNotice>
              ) : null}

              <div data-composer-action>
                {!preview ? (
                  <Button
                    type="button"
                    variant="action"
                    className="w-full"
                    onClick={() => void runPreview()}
                    loading={busy}
                    loadingLabel="Checking…"
                    disabled={recipient === null || standId === ""}
                  >
                    Preview text
                  </Button>
                ) : needsConsent ? (
                  <Button
                    type="button"
                    variant="action"
                    className="w-full"
                    onClick={() => void recordConsent()}
                    loading={busy}
                    loadingLabel="Saving…"
                    disabled={!consentMethod || !consentConfirmed}
                  >
                    Save their agreement
                  </Button>
                ) : canSend ? (
                  <Button
                    type="button"
                    variant="action"
                    className="w-full"
                    onClick={() => void send()}
                    loading={busy}
                    loadingLabel="Sending…"
                  >
                    Send to ••• {preview.recipientLastFour}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="hidden md:sticky md:top-8 md:block">{phonePreview(false)}</div>
          </div>
        )}
      </section>

      <RecentList recent={recent} />
    </div>
  );
}

function AgreementHint({ state }: { state: CustomerConsentState }) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 text-sm",
        state.kind === "opted_out" ? "font-medium text-danger" : "text-muted",
      )}
      data-consent={state.kind}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          state.kind === "agreed" && "bg-brand",
          state.kind === "no_record" && "border border-[color:var(--rb-border-strong)]",
          state.kind === "opted_out" && "bg-danger",
        )}
      />
      {state.kind === "no_record"
        ? "No agreement recorded. You'll be asked how they agreed."
        : state.label}
    </p>
  );
}

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

/**
 * What changed in the list since it was first drawn. A request just sent
 * arrives as a new row, which settles in (opacity and 4px, 200ms); a status
 * that moved on, Sending to Delivered, fades to the new one. Rows that were
 * already there when the page opened are simply there. Calm on purpose: a
 * text going out is routine, not a moment.
 */
function useListChanges(recent: readonly RecentRequest[]) {
  // The list as it was before the latest change; null until it first changes.
  const [state, setState] = useState<{
    list: readonly RecentRequest[];
    before: Map<string, string> | null;
  }>({
    list: recent,
    before: null,
  });
  if (state.list !== recent) {
    setState({
      list: recent,
      before: new Map(state.list.map((item) => [item.id, item.status])),
    });
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
            const status = textRequestStatus(item.status);
            return (
              <li
                key={item.id}
                className={cn("flex min-h-14 items-center gap-3 py-3", isNew(item) && "animate-row-in")}
              >
                {/* The number and the day never wrap; a long status does,
                    inside its own column. */}
                <span className="shrink-0 whitespace-nowrap text-base tabular-nums text-ink">
                  ••• {item.recipientLastFour ?? "????"}
                </span>
                <span className="shrink-0 whitespace-nowrap text-sm text-muted">{relativeDay(item.createdAt)}</span>
                <span
                  key={item.status}
                  className={cn(
                    "ml-auto inline-flex min-w-0 items-center justify-end gap-1.5 text-right text-sm",
                    statusMoved(item) && "animate-fade-in",
                    status.tone === "bad" ? "font-medium text-danger" : "text-muted",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
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
