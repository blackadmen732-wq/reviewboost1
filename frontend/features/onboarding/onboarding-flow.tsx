"use client";

import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Printer,
  RefreshCw,
  Store,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { OutcomeCheckNotice } from "@/components/ui/outcome-check-notice";
import { TestGoogleLinkButton } from "@/features/dashboard/google-link-care";
import { CodeLoadFailed } from "@/features/tags/code-load-failed";
import { PrintCodeSheet } from "@/features/tags/print-code-sheet";
import {
  GOOGLE_LINK_BLAST,
  GOOGLE_LINK_HELP_STEPS,
  GOOGLE_LINK_LATER,
  GOOGLE_LINK_NOT_REVIEW_LINK,
  googleLinkState,
} from "@/features/dashboard/google-link-copy";
import { withWriteDeadline } from "@/lib/api/read-deadline";
import { useAuthenticatedQr } from "@/lib/hooks/use-authenticated-qr";
import type { IsDone } from "@/lib/recovery/check-outcome";
import { useOutcomeCheck } from "@/lib/recovery/use-outcome-check";
import { isGoogleReviewWritingUrl } from "@/lib/security/google-review-url";
import { billingForPlan } from "@/lib/owner/plan-choice";
import { PLAN_CATALOG, type PlanId } from "@/lib/owner/plan-catalog";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Setup, in three screens.
 *
 * One question per screen, one button under it. A single long form with five
 * fields looks like paperwork, and paperwork is where people close the tab.
 * Three short screens take the same total taps and feel like progress.
 *
 * The Google link is the hard part and everything here is arranged around it.
 * An owner who has never opened Google Business Profile does not know what a
 * "review URL" is, cannot be told to "copy the place ID", and will not read a
 * paragraph explaining either. So: a button that opens the right Google page
 * for them, three short steps, and a field that tells them the moment the
 * pasted link is the right kind — before they submit, not after.
 *
 * It is also skippable. Trapping someone on the one step they cannot complete
 * is how you lose them permanently; they can add it later and their code still
 * prints today.
 */

type Step = "name" | "google" | "done";

/** Where an unfinished setup keeps what was typed, for this tab only. */
const ONBOARDING_DRAFT_KEY = "rb.onboarding.draft";

interface Created {
  organizationId?: string;
  standUrl: string;
  standId: string;
}

export function OnboardingFlow({
  selectedPlan = null,
}: {
  selectedPlan?: PlanId | null;
}) {
  const [step, setStep] = useState<Step>("name");
  /** Setup finished without a Google link, so the Tag will not work yet. */
  const [linkSkipped, setLinkSkipped] = useState(false);
  // A new step starts at its top. Pressed at the bottom of a long step, the
  // next one opened scrolled down, its heading cut off.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo?.({ top: 0 });
  }, [step]);
  const [name, setName] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  /** Which button started the save, so only that one shows it is working. */
  const [busy, setBusy] = useState<"link" | "later" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  // Nothing reaches the server until the last step, and the Google step sends
  // the owner off to Google to copy their link. A reload, or a phone dropping
  // the tab meanwhile, must not wipe what they typed. sessionStorage, not
  // localStorage: the draft stays in this tab and never outlives it.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(ONBOARDING_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { name?: unknown; googleUrl?: unknown; step?: unknown };
      const savedName = typeof draft.name === "string" ? draft.name : "";
      if (savedName) setName(savedName);
      if (typeof draft.googleUrl === "string" && draft.googleUrl) setGoogleUrl(draft.googleUrl);
      if (draft.step === "google" && savedName.trim()) setStep("google");
    } catch {
      // Storage refused (private mode, blocked site data): start empty.
    }
  }, []);
  useEffect(() => {
    try {
      if (step === "done") window.sessionStorage.removeItem(ONBOARDING_DRAFT_KEY);
      else if (name || googleUrl) {
        window.sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ name, googleUrl, step }));
      }
    } catch {
      // Nothing to keep the draft in; the flow still works without it.
    }
  }, [name, googleUrl, step]);

  const qr = useAuthenticatedQr(
    created?.standId ?? null,
    created?.organizationId,
  );

  // The business as a check found it, after a lost answer.
  const recovered = useRef<Created | null>(null);
  const createCheck = useOutcomeCheck({
    onDone: () => {
      if (!recovered.current) return;
      setCreated(recovered.current);
      setStep("done");
    },
    onNotDone: () => setError("Your business wasn’t created. Try again."),
    onExpired: setError,
  });

  /**
   * Was the business made after all? Its owner now has one, with its first
   * Tag (one transaction makes both). A read, so nothing is made twice: a
   * second try would also have been told its own name was "already taken".
   */
  function isCreated(token: string): IsDone {
    return async (signal) => {
      const auth = { Authorization: `Bearer ${token}` };
      const state = await fetch("/api/v1/onboarding", { signal, headers: auth });
      if (!state.ok) throw new Error("No answer yet.");
      const { data } = (await state.json()) as {
        data: { hasOrganization: boolean; organization: { id: string } | null };
      };
      if (!data.hasOrganization || !data.organization) return false;
      const tags = await fetch("/api/v1/review-stands", {
        signal,
        headers: { ...auth, "X-Organization-Id": data.organization.id },
      });
      if (!tags.ok) throw new Error("No answer yet.");
      const { data: stands } = (await tags.json()) as {
        data: Array<{ standId: string }>;
      };
      const first = stands[0];
      if (!first) throw new Error("No answer yet.");
      recovered.current = {
        standId: first.standId,
        organizationId: data.organization.id,
        standUrl: "",
      };
      return true;
    };
  }

  const trimmedUrl = googleUrl.trim();
  const urlLooksRight =
    trimmedUrl !== "" && isGoogleReviewWritingUrl(trimmedUrl);

  function slugify(value: string): string {
    // Generated rather than asked for. "Choose a web address" is a question
    // that means nothing to a restaurant owner and stops them cold.
    const base = value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);

    const suffix = Math.random().toString(36).slice(2, 7);
    return base.length >= 3 ? `${base}-${suffix}` : `business-${suffix}`;
  }

  /**
   * Create the business, and never strand the owner if the network drops.
   *
   * The session lookup and the POST used to sit outside any try/catch with
   * `busy` already set, so a rejected request escaped the voided click handler
   * and left both Continue and "I will do this later" spinning and disabled,
   * with no error shown. That is the first screen of the product, and the only
   * way out was a reload that loses what they typed.
   */
  async function finish(withUrl: string | undefined) {
    if (createCheck.pending) return;
    setBusy(withUrl ? "link" : "later");
    setLinkSkipped(!withUrl);
    setError(null);
    let token: string | null = null;

    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();

      if (!session) {
        setError("Your session expired. Please sign in again.");
        return;
      }
      const sent = session.access_token;
      token = sent;

      const response = await withWriteDeadline(
        async (signal) =>
          await fetch("/api/v1/onboarding", {
            signal,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sent}`,
            },
            body: JSON.stringify({
              name: name.trim(),
              slug: slugify(name),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
              defaultLocale: "en",
              locationName: name.trim(),
              ...(withUrl ? { googleReviewUrl: withUrl } : {}),
            }),
          }),
      );

      if (!response.ok) {
        // A server error can come after the business was made: find out.
        if (response.status >= 500) {
          createCheck.start(isCreated(sent), { serverAnswered: true });
          return;
        }
        setError(
          response.status === 409
            ? "That name is already taken. Try adding your street or city."
            : "That didn’t go through. Please try again.",
        );
        return;
      }

      const body = (await response.json()) as { data: Created };
      setCreated(body.data);
      setStep("done");
    } catch {
      if (token) {
        // The answer was lost: look for the business rather than make another.
        createCheck.start(isCreated(token));
        return;
      }
      setError(
        "Could not reach ReviewBoost. Check your connection and try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------ step 1 -----

  if (step === "name") {
    return (
      <div className="flex flex-col gap-8" data-onboarding-step="name">
        <Progress current={1} />

        <div className="flex flex-col gap-2">
          <div className="mb-2 grid size-14 place-items-center rounded-full bg-brand-soft">
            <Store className="size-7 text-brand-text" aria-hidden="true" />
          </div>
          <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink">
            What is your business called?
          </h1>
          <p className="text-base text-muted">
            Use the name on your shop or business.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Input
            id="business-name"
            value={name}
            autoFocus
            autoComplete="organization"
            placeholder="Corner Cafe"
            aria-label="Business name"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            className="h-16 text-lg"
            invalid={error !== null && name.trim().length < 2}
          />

          {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        </div>

        <Button
          variant="action"
          size="lg"
          onClick={() => {
            // Never a dead grey button: pressing it says what is missing.
            if (name.trim().length < 2) {
              setError("Enter your business name to continue.");
              return;
            }
            setError(null);
            setStep("google");
          }}
        >
          Continue
        </Button>
      </div>
    );
  }

  // ------------------------------------------------------------ step 2 -----

  if (step === "google") {
    return (
      <div className="flex flex-col gap-8" data-onboarding-step="google">
        <BackButton onClick={() => setStep("name")} />
        <Progress current={2} />

        <div className="flex flex-col gap-2">
          <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink">
            Your Google link
          </h1>
          <p className="text-base text-muted">
            This is where customers go to leave you a review.
          </p>
          <p className="text-sm text-muted">{GOOGLE_LINK_BLAST}</p>
        </div>

        {/* Numbered, three steps, no paragraph. Someone who has never done this
            can follow it while holding a phone in the other hand. */}
        <ol className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-quiet p-5">
          {GOOGLE_LINK_HELP_STEPS.map((instruction, index) => (
            <li key={instruction} className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-sm font-bold text-ink">
                {index + 1}
              </span>
              <span className="pt-0.5 text-base leading-relaxed text-ink">
                <ButtonWords text={instruction} />
              </span>
            </li>
          ))}
        </ol>

        <Button variant="secondary" asChild>
          <a
            href="https://business.google.com/reviews"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Google
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </Button>

        <div className="flex flex-col gap-3">
          <Input
            id="google-url"
            value={googleUrl}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Paste your link here"
            aria-label="Google review link"
            onChange={(event) => {
              setGoogleUrl(event.target.value);
              setError(null);
            }}
            className="h-16 text-base"
            invalid={trimmedUrl !== "" && !urlLooksRight}
          />

          {/* Confirmation the instant it is right, so nobody submits and waits
              to find out. A green tick here removes real anxiety. */}
          {urlLooksRight ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-brand-text">
                <Check className="size-4" aria-hidden="true" />
                That is the right link
              </p>
              {/* Open it before saving it: the one check that proves it is
                  this business's own review box. */}
              <TestGoogleLinkButton url={trimmedUrl} />
            </>
          ) : null}

          {trimmedUrl !== "" && !urlLooksRight ? (
            <InlineNotice kind="error">
              {googleLinkState(trimmedUrl) === "legacy"
                ? GOOGLE_LINK_NOT_REVIEW_LINK
                : "That does not look like a Google link. It should start with g.page or google.com."}
            </InlineNotice>
          ) : null}

          {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
          <OutcomeCheckNotice check={createCheck} />
        </div>

        <div className="flex flex-col gap-3">
          <Button
            variant="action"
            size="lg"
            loading={busy === "link"}
            disabled={busy === "later" || createCheck.pending}
            loadingLabel="Setting up…"
            onClick={() => {
              if (!urlLooksRight) {
                // A wrong link already has its own message under the field.
                if (trimmedUrl === "") setError("Paste your Google link first, or tap “I will do this later”.");
                return;
              }
              void finish(trimmedUrl);
            }}
          >
            Continue
          </Button>

          {/* Always available. The person who cannot find this link today is
              exactly the person who must not be locked out today. */}
          <Button
            variant="ghost"
            loading={busy === "later"}
            disabled={busy === "link" || createCheck.pending}
            loadingLabel="Setting up…"
            onClick={() => void finish(undefined)}
          >
            I will do this later
          </Button>
          {/* What skipping means. Not under a link already pasted right. */}
          {urlLooksRight ? null : (
            <p className="text-sm text-muted" data-google-unset="true">
              {GOOGLE_LINK_LATER}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ step 3 -----

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-brand-soft">
        <Check
          className="size-10 text-brand-text"
          strokeWidth={3}
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-col gap-2">
        {/* Made, not ready: until a plan starts (and a Google link is set),
            a scan shows "This review link isn't active". */}
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Your Tag is made
        </h1>
        {/* It is not working yet, and saying "you are all set" would mean a
            business puts this on the counter and finds out from a customer.
            The door opens when a plan does. */}
        <p className="text-base text-muted">
          {selectedPlan
            ? `Your ${PLAN_CATALOG[selectedPlan].name} choice is saved. Review the price and payment details next to switch on your Tag.`
            : "Choose a plan to switch it on. Starter is free for seven days, and nothing is charged until the trial ends."}
        </p>
        {linkSkipped ? (
          <p className="text-base font-medium text-ink" data-done-google-missing>
            {GOOGLE_LINK_LATER}
          </p>
        ) : null}
      </div>

      {created ? (
        <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          {qr.status === "error" ? (
            <div className="mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center">
              <CodeLoadFailed
                standId={created.standId}
                failures={qr.failures}
                onReload={qr.reload}
              />
            </div>
          ) : qr.status === "expired" ? (
            <div className="mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-muted">Please sign in again</p>
                <button
                  type="button"
                  onClick={qr.reload}
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-text"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Try again
                </button>
              </div>
            </div>
          ) : qr.objectUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr.objectUrl}
              alt="Your QR code"
              className="mx-auto aspect-square w-full max-w-[220px]"
            />
          ) : (
            <div className="mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center">
              <div className="size-8 animate-spin rounded-full border-4 border-border border-t-brand-text" />
            </div>
          )}
        </div>
      ) : null}
      {created && qr.status === "ready" && qr.objectUrl ? (
        <PrintCodeSheet src={qr.objectUrl} businessName={name.trim()} />
      ) : null}

      <div className="flex w-full flex-col gap-3">
        <Button variant="action" size="lg" asChild>
          <a href={billingForPlan(selectedPlan)}>
            {selectedPlan ? "Continue to your plan" : "Choose a plan"}
          </a>
        </Button>
        <Button
          variant="secondary"
          disabled={qr.status !== "ready"}
          onClick={() => window.print()}
        >
          <Printer className="size-5" aria-hidden="true" />
          Print this code
        </Button>
        <Button
          variant="secondary"
          loading={qr.downloading}
          onClick={() => qr.download("reviewboost-qr.svg")}
        >
          {/* "Save code", as on the Tag page. It saves an SVG, which a
              phone keeps in Downloads, not Photos, so "Save to my phone"
              pointed an owner at the wrong place to look. */}
          <Download className="size-5" aria-hidden="true" />
          Save code
        </Button>
        <Button variant="ghost" asChild>
          <a href="/home">Go to my dashboard</a>
        </Button>
      </div>
    </div>
  );
}

function Progress({ current }: { current: number }) {
  return (
    <div
      className="flex items-center gap-2"
      role="img"
      aria-label={`Step ${current} of 3`}
    >
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={
            step <= current
              ? "h-1.5 flex-1 rounded-full bg-brand"
              : "h-1.5 flex-1 rounded-full bg-border"
          }
        />
      ))}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 inline-flex w-fit items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back
    </button>
  );
}

/**
 * Google's button names, drawn as buttons. "Tap “Get more reviews”" is a
 * sentence to read; the same words in a pill are a thing to look for on the
 * screen next to this one.
 */
function ButtonWords({ text }: { text: string }) {
  const parts = text.split(/“([^”]+)”/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span
            key={index}
            className="mx-0.5 inline-flex items-center rounded-full border border-[color:var(--rb-border-strong)] bg-surface px-2.5 py-0.5 text-[0.9375rem] font-semibold text-ink"
          >
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
