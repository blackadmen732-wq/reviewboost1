"use client";

import { useState } from "react";
import Link from "next/link";
import { ownerOrAdmin } from "@/lib/owner/permissions";
import { relativeDay } from "@/lib/utils/relative-day";
import { cn } from "@/lib/utils/cn";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";

/** A failed fetch says "Failed to fetch" or "Load failed"; an owner gets this. */
function reachError(caught: unknown): string {
  return caught instanceof SessionExpiredError
    ? caught.message
    : "Could not reach ReviewBoost. Check your connection and try again.";
}

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
  canSendRequests: boolean;
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
export function TextRequestComposer({
  balance,
  tags,
  recent,
  canSendRequests,
  customers = [],
}: TextRequestComposerProps) {
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
  const [sendUncertain, setSendUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What is missing before a preview can be asked for, said on the tap. */
  const [missing, setMissing] = useState<string | null>(null);

  async function authorizedFetch(
    path: string,
    body: unknown,
  ): Promise<Response> {
    return ownerFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      setError(reachError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!canSend || busy) return;
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
      // The notice above says what to do; the cause is only worth naming when
      // it is the session.
      setSendUncertain(true);
      setError(caught instanceof SessionExpiredError ? caught.message : null);
    } finally {
      setBusy(false);
    }
  }

  async function recordConsent() {
    if (!canSendRequests || busy || !consentMethod || !consentConfirmed) return;
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

      const payload = (await response.json()) as {
        data: { eligibility: Eligibility };
      };
      setPreview((current) =>
        current
          ? { ...current, eligibility: payload.data.eligibility }
          : current,
      );
      notify.success("Saved", "Their agreement is recorded.");
    } catch (caught) {
      setError(reachError(caught));
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
    setMissing(null);
  }

  const canSend =
    canSendRequests &&
    !sendUncertain &&
    preview !== null &&
    preview.eligibility.allowed &&
    standId !== "" &&
    balance.total >= preview.segments;
  const needsConsent =
    preview !== null &&
    !preview.eligibility.allowed &&
    preview.eligibility.reason === "no_consent";

  return (
    <div className="flex flex-col gap-6">
      {sendUncertain ? (
        <InlineNotice kind="info">
          <p>Could not confirm sending. Check Recent before trying again.</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              router.refresh();
              clearPreview();
              setSendUncertain(false);
            }}
          >
            Check recent requests
          </Button>
        </InlineNotice>
      ) : null}
      <div>
        <BalanceLine balance={balance} />
        {balance.total === 0 ? (
          <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-muted">
            You can preview a request now. Sending needs available texts and the
            customer’s recorded agreement.{" "}
            <Link
              href="/settings/billing"
              className="font-medium text-brand-text underline underline-offset-4"
            >
              View billing and allowance
            </Link>
          </p>
        ) : null}
      </div>

      <section
        className="flex flex-col gap-5"
        aria-labelledby="compose-heading"
      >
        <h2 id="compose-heading" className="text-base font-semibold text-ink">
          Send a request
        </h2>

        {!canSendRequests ? (
          <p
            className="text-base text-muted"
            data-text-request-access="read-only"
          >
            {ownerOrAdmin("send Text Requests")}
          </p>
        ) : tags.length === 0 ? (
          <InlineNotice kind="info">
            <p>Create a Tag first — the message carries its link.</p>
            <Link
              href="/stands"
              className="mt-2 inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-4"
            >
              Go to Set up
            </Link>
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
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                Customer&apos;s mobile number
                <Input
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
            )}

            {hasCustomers ? (
              <button
                type="button"
                disabled={busy}
                className="-mt-2 min-h-11 self-start text-sm font-medium text-ink underline underline-offset-4 hover:no-underline"
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

            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
              Which Tag
              <NativeSelect
                disabled={busy}
                value={standId}
                onChange={(event) => {
                  setStandId(event.target.value);
                  clearPreview();
                }}
              >
                {tags.map((tag) => (
                  <option key={tag.standId} value={tag.standId}>
                    {tag.locationName
                      ? `${tag.label} — ${tag.locationName}`
                      : tag.label}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <fieldset disabled={busy} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink">
                Message
              </legend>
              {TEXT_REQUEST_TEMPLATE_IDS.map((id) => (
                <label
                  key={id}
                  className="flex min-h-14 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface p-4 text-base text-ink transition-colors hover:border-[color:var(--rb-border-strong)] has-[:checked]:border-[color:var(--rb-ink)] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[color:var(--rb-focus-soft)]"
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
                  <span>
                    {TEXT_REQUEST_TEMPLATES[id].replace(
                      "{{link}}",
                      "[your Tag link]",
                    )}
                  </span>
                </label>
              ))}
              <span className="text-xs text-muted">
                Your business name goes in front, and every text ends with
                &ldquo;Reply STOP to opt out.&rdquo;
              </span>
            </fieldset>

            {preview ? (
              <section
                className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border bg-canvas p-4"
                aria-labelledby="preview-heading"
              >
                <h3
                  id="preview-heading"
                  className="text-sm font-medium text-muted"
                >
                  What ••• {preview.recipientLastFour} will get
                </h3>
                <p className="whitespace-pre-wrap break-words text-base text-ink">
                  {preview.body}
                </p>
                <p className="text-sm text-muted">
                  Counts as {preview.segments}{" "}
                  {preview.segments === 1 ? "text" : "texts"}. You have{" "}
                  {balance.total.toLocaleString()} left.
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
                className="flex flex-col gap-3 border-y border-border py-5"
                aria-labelledby="consent-heading"
              >
                <h3
                  id="consent-heading"
                  className="text-base font-semibold text-ink"
                >
                  Did this customer agree to a text?
                </h3>
                <p className="text-sm text-muted">
                  {preview.eligibility.message} Only continue if they said yes.
                </p>
                <fieldset disabled={busy} className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-muted">
                    How they agreed
                  </legend>
                  {CONSENT_METHOD_IDS.map((id) => (
                    <label
                      key={id}
                      className="flex min-h-11 items-center gap-3 text-base text-ink"
                    >
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
                    onChange={(event) =>
                      setConsentConfirmed(event.target.checked)
                    }
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
              <InlineNotice
                kind="error"
                title="That did not go through"
                blocking
              >
                <p>{error}</p>
              </InlineNotice>
            ) : null}

            {preview && balance.total < preview.segments ? (
              <InlineNotice kind="info">
                <p>
                  This needs {preview.segments}{" "}
                  {preview.segments === 1 ? "text" : "texts"} and you have{" "}
                  {balance.total.toLocaleString()} left.
                </p>
                <Link
                  href="/settings/billing"
                  className="mt-2 inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-4"
                >
                  View billing and texts
                </Link>
              </InlineNotice>
            ) : null}

            {/* One button, and it is the next step: Preview until the server
                has shown the exact text, then Send once that number may be
                texted. A Send that cannot be pressed is not drawn: the reason
                it cannot is already on the screen. */}
            <div className="flex flex-col gap-2">
              {preview === null ? (
                <Button
                  type="button"
                  variant="action"
                  className="sm:w-auto"
                  onClick={() => {
                    if (!hasRecipient) {
                      setMissing(
                        mode === "customer"
                          ? "Choose a customer first."
                          : "Type the customer’s mobile number first.",
                      );
                      return;
                    }
                    setMissing(null);
                    void runPreview();
                  }}
                  loading={busy}
                  loadingLabel="Getting the exact text…"
                >
                  Preview text request
                </Button>
              ) : canSend ? (
                <Button
                  type="button"
                  variant="action"
                  className="sm:w-auto"
                  onClick={() => void send()}
                  loading={busy}
                  loadingLabel="Sending…"
                >
                  Send text request
                </Button>
              ) : null}
              {missing ? (
                <p role="alert" className="text-sm font-medium text-danger" data-composer-missing>
                  {missing}
                </p>
              ) : null}
            </div>
          </>
        )}
      </section>

      <RecentList recent={recent} />
    </div>
  );
}

function BalanceLine({ balance }: { balance: Balance }) {
  return (
    <section aria-label="Texts left">
      <p className="flex items-baseline gap-2">
        <span className="text-[2rem] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums">
          {balance.total.toLocaleString()}
        </span>
        <span className="text-base text-muted">
          {balance.total === 1 ? "text left" : "texts left"}
        </span>
      </p>
      {balance.purchased > 0 ? (
        <p className="mt-2 text-sm text-muted">
          {balance.monthly.toLocaleString()} from this month&apos;s plan, used
          first · {balance.purchased.toLocaleString()} purchased, kept until
          used
        </p>
      ) : null}
    </section>
  );
}

const STATUS: Record<
  string,
  { label: string; tone: "ok" | "wait" | "bad" | "off" }
> = {
  scheduled: { label: "Scheduled", tone: "wait" },
  queued: { label: "Queued", tone: "wait" },
  sending: { label: "Sending", tone: "wait" },
  submitted: { label: "Sent", tone: "wait" },
  provider_unknown: { label: "Delivery unknown", tone: "wait" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Not delivered", tone: "bad" },
  suppressed: { label: "Not sent · opted out or blocked", tone: "off" },
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
      before !== null &&
      before.has(item.id) &&
      before.get(item.id) !== item.status,
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
            const status = STATUS[item.status] ?? {
              label: item.status,
              tone: "wait" as const,
            };
            return (
              <li
                key={item.id}
                className={cn(
                  "flex min-h-14 items-center gap-3 py-3",
                  isNew(item) && "animate-row-in",
                )}
              >
                {/* Number over time, status on the right: three columns
                    broke "••• 2210" across two lines at phone width. */}
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-nowrap text-base tabular-nums text-ink">
                    ••• {item.recipientLastFour ?? "????"}
                  </span>
                  <span className="block text-sm text-muted">
                    {relativeDay(item.createdAt)}
                  </span>
                </span>
                <span
                  key={item.status}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 text-right text-sm",
                    statusMoved(item) && "animate-fade-in",
                    status.tone === "bad"
                      ? "font-medium text-danger"
                      : "text-muted",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 rounded-full",
                      status.tone === "ok" && "bg-brand",
                      status.tone === "wait" &&
                        "bg-[color:var(--rb-border-strong)]",
                      status.tone === "bad" && "bg-danger",
                      status.tone === "off" &&
                        "border border-[color:var(--rb-border-strong)]",
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
