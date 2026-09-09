"use client";

import { ArrowLeft, Check, Copy, Download, ExternalLink, Printer, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { TestGoogleLinkButton } from "@/features/dashboard/google-link-care";
import {
  GOOGLE_LINK_BLAST,
  GOOGLE_LINK_HELP_STEPS,
  GOOGLE_LINK_INVALID,
  GOOGLE_LINK_LATER,
} from "@/features/dashboard/google-link-copy";
import {
  advanceOnboarding,
  type CreatedStand,
  ONBOARDING_STEP_COUNT,
  onboardingStepNumber,
  type OnboardingStep,
  prevOnboardingStep,
} from "@/features/onboarding/onboarding-model";
import { useAuthenticatedQr } from "@/lib/hooks/use-authenticated-qr";
import { isValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Activation. One question per screen.
 *
 * Google is skippable. The stand is created there, then they preview the
 * frozen customer page as it actually ships — a new tab on /q, not a mock.
 */

export function OnboardingFlow() {
  const [step, setStep] = useState<OnboardingStep>("business");
  const [name, setName] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedStand | null>(null);
  const [googleLinkSaved, setGoogleLinkSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const qr = useAuthenticatedQr(created?.standId ?? null);

  const trimmedUrl = googleUrl.trim();
  const urlLooksRight = trimmedUrl !== "" && isValidatedGoogleReviewUrl(trimmedUrl);

  function slugify(value: string): string {
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

  function go(next: OnboardingStep | null) {
    if (!next) return;
    setError(null);
    setStep(next);
  }

  async function persistGoogleUrl(url: string, accessToken: string): Promise<boolean> {
    const response = await fetch("/api/v1/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ googleReviewUrl: url }),
    });
    return response.ok;
  }

  async function finish(withUrl: string | undefined) {
    if (created) {
      if (withUrl) {
        setBusy(true);
        setError(null);

        const {
          data: { session },
        } = await supabaseBrowser().auth.getSession();

        if (!session) {
          setBusy(false);
          setError("Your session expired. Please sign in again.");
          return;
        }

        const saved = await persistGoogleUrl(withUrl, session.access_token);
        setBusy(false);

        if (!saved) {
          setError("Could not save that. Please try again.");
          return;
        }

        setGoogleLinkSaved(true);
      }
      go(advanceOnboarding("google", created));
      return;
    }

    setBusy(true);
    setError(null);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      setError("Your session expired. Please sign in again.");
      return;
    }

    const response = await fetch("/api/v1/onboarding", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        name: name.trim(),
        slug: slugify(name),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        defaultLocale: "en",
        locationName: name.trim(),
        ...(withUrl ? { googleReviewUrl: withUrl } : {}),
      }),
    });

    setBusy(false);

    if (!response.ok) {
      setError(
        response.status === 409
          ? "That name is already taken. Try adding your street or city."
          : "Something went wrong. Please try again.",
      );
      return;
    }

    const body = (await response.json()) as { data: CreatedStand };
    setCreated(body.data);
    setGoogleLinkSaved(Boolean(withUrl));
    go(advanceOnboarding("google", body.data));
  }

  async function copyStandUrl() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.standUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the link.");
    }
  }

  const back = prevOnboardingStep(step);

  return (
    <div className="flex flex-col gap-8" data-onboarding-step={step}>
      <div className="flex flex-col gap-8 print:hidden">
        {back ? <BackButton onClick={() => go(back)} /> : null}
        <Progress current={onboardingStepNumber(step)} />
      </div>

      {step === "business" ? (
        <BusinessStep
          name={name}
          error={error}
          onName={(value) => {
            setName(value);
            setError(null);
          }}
          onContinue={() => go(advanceOnboarding("business", created))}
        />
      ) : null}

      {step === "google" ? (
        <GoogleStep
          googleUrl={googleUrl}
          trimmedUrl={trimmedUrl}
          urlLooksRight={urlLooksRight}
          busy={busy}
          error={error}
          onUrl={(value) => {
            setGoogleUrl(value);
            setError(null);
          }}
          onContinue={() => void finish(trimmedUrl)}
          onSkip={() => void finish(undefined)}
        />
      ) : null}

      {step === "preview" && created ? (
        <PreviewStep
          standUrl={created.standUrl}
          googleLinkSaved={googleLinkSaved}
          onContinue={() => go(advanceOnboarding("preview", created))}
        />
      ) : null}

      {step === "tag" && created ? (
        <TagStep
          businessName={name.trim()}
          googleLinkSaved={googleLinkSaved}
          onContinue={() => go(advanceOnboarding("tag", created))}
        />
      ) : null}

      {step === "print" && created ? (
        <PrintStep
          qr={qr}
          copied={copied}
          googleLinkSaved={googleLinkSaved}
          onCopy={() => void copyStandUrl()}
          onContinue={() => go(advanceOnboarding("print", created))}
        />
      ) : null}

      {step === "ready" ? <ReadyStep googleLinkSaved={googleLinkSaved} /> : null}
    </div>
  );
}

function BusinessStep({
  name,
  error,
  onName,
  onContinue,
}: {
  name: string;
  error: string | null;
  onName: (value: string) => void;
  onContinue: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          What is your business called?
        </h1>
        <p className="text-base text-muted">This is what customers will see.</p>
      </div>

      <div className="flex flex-col gap-3">
        <Input
          id="business-name"
          value={name}
          autoFocus
          autoComplete="organization"
          placeholder="Corner Cafe"
          aria-label="Business name"
          onChange={(event) => onName(event.target.value)}
          className="h-16 text-lg"
        />
        {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </div>

      <Button
        variant="action"
        size="lg"
        disabled={name.trim().length < 2}
        onClick={onContinue}
      >
        Continue
      </Button>
    </>
  );
}

function GoogleStep({
  googleUrl,
  trimmedUrl,
  urlLooksRight,
  busy,
  error,
  onUrl,
  onContinue,
  onSkip,
}: {
  googleUrl: string;
  trimmedUrl: string;
  urlLooksRight: boolean;
  busy: boolean;
  error: string | null;
  onUrl: (value: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Your Google link
        </h1>
        <p className="text-base text-muted">
          This is where every customer goes to leave you a review — the same
          link, whatever they rated.
        </p>
        <p className="text-sm leading-relaxed text-muted">{GOOGLE_LINK_BLAST}</p>
      </div>

      <ol className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-quiet p-5">
        {GOOGLE_LINK_HELP_STEPS.map((instruction, index) => (
          <li key={instruction} className="flex items-start gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-sm font-bold text-ink">
              {index + 1}
            </span>
            <span className="pt-0.5 text-base text-ink">{instruction}</span>
          </li>
        ))}
      </ol>

      <Button variant="secondary" asChild>
        <a href="https://business.google.com/reviews" target="_blank" rel="noopener noreferrer">
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
          onChange={(event) => onUrl(event.target.value)}
          className="h-16 text-base"
          invalid={trimmedUrl !== "" && !urlLooksRight}
        />

        {urlLooksRight ? (
          <p className="flex items-center gap-2 text-sm font-medium text-brand-text">
            <Check className="size-4" aria-hidden="true" />
            That is the right link
          </p>
        ) : null}

        {trimmedUrl !== "" && !urlLooksRight ? (
          <InlineNotice kind="error">{GOOGLE_LINK_INVALID}</InlineNotice>
        ) : null}

        {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </div>

      <TestGoogleLinkButton url={trimmedUrl} />

      <div className="flex flex-col gap-3">
        <Button
          variant="action"
          size="lg"
          loading={busy}
          loadingLabel="Setting up…"
          disabled={!urlLooksRight}
          onClick={onContinue}
        >
          Continue
        </Button>
        <Button variant="ghost" loading={busy} onClick={onSkip}>
          I will do this later
        </Button>
      </div>
    </>
  );
}

function PreviewStep({
  standUrl,
  googleLinkSaved,
  onContinue,
}: {
  standUrl: string;
  googleLinkSaved: boolean;
  onContinue: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          This is what customers see
        </h1>
        <p className="text-base leading-relaxed text-muted">
          The live page. We do not restyle it here. Open it, then come back.
        </p>
        <GoogleUnsetNote show={!googleLinkSaved} />
      </div>

      <Button variant="action" size="lg" asChild>
        <a href={standUrl} target="_blank" rel="noopener noreferrer">
          Open customer page
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </Button>

      <Button variant="ghost" size="lg" onClick={onContinue}>
        Continue
      </Button>
    </>
  );
}

function TagStep({
  businessName,
  googleLinkSaved,
  onContinue,
}: {
  businessName: string;
  googleLinkSaved: boolean;
  onContinue: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Your first Tag is ready
        </h1>
        <p className="text-base leading-relaxed text-muted">
          A Tag is the code people scan. You have one
          {businessName ? ` for ${businessName}` : ""}. Print the code or
          program a blank NFC tag with the same link.
        </p>
        <GoogleUnsetNote show={!googleLinkSaved} />
      </div>

      <Button variant="action" size="lg" onClick={onContinue}>
        Continue
      </Button>
    </>
  );
}

function PrintStep({
  qr,
  copied,
  googleLinkSaved,
  onCopy,
  onContinue,
}: {
  qr: ReturnType<typeof useAuthenticatedQr>;
  copied: boolean;
  googleLinkSaved: boolean;
  onCopy: () => void;
  onContinue: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Print or program
        </h1>
        <p className="text-base leading-relaxed text-muted">
          Put the code where people pay. To program a tag, write this same link
          onto a blank NFC tag — you can also do that from Tags after setup.
        </p>
        <GoogleUnsetNote show={!googleLinkSaved} />
      </div>

      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
        {qr.status === "error" || qr.status === "expired" ? (
          <div className="mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted">
                {qr.status === "expired" ? "Please sign in again" : "Could not load QR code"}
              </p>
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

      <div className="flex flex-col gap-3 print:hidden">
        <Button variant="action" size="lg" onClick={() => window.print()}>
          <Printer className="size-5" aria-hidden="true" />
          Print this code
        </Button>
        <Button
          variant="secondary"
          loading={qr.downloading}
          onClick={() => qr.download("reviewboost-qr.svg")}
        >
          <Download className="size-5" aria-hidden="true" />
          Save to my phone
        </Button>
        <Button variant="secondary" onClick={onCopy}>
          {copied ? (
            <Check className="size-5" aria-hidden="true" />
          ) : (
            <Copy className="size-5" aria-hidden="true" />
          )}
          {copied ? "Link copied" : "Copy the tag link"}
        </Button>
        <Button variant="ghost" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </>
  );
}

function ReadyStep({ googleLinkSaved }: { googleLinkSaved: boolean }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          You are ready
        </h1>
        <p className="text-base leading-relaxed text-muted">
          Print the code or program the tag, then put it where people pay.
        </p>
        <GoogleUnsetNote show={!googleLinkSaved} />
      </div>

      <Button variant="action" size="lg" asChild>
        <a href="/home">Go to Home</a>
      </Button>
    </>
  );
}

function GoogleUnsetNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="text-sm leading-relaxed text-muted" data-google-unset="true">
      {GOOGLE_LINK_LATER}
    </p>
  );
}

function Progress({ current }: { current: number }) {
  return (
    <div
      className="flex items-center gap-2"
      role="img"
      aria-label={`Step ${current} of ${ONBOARDING_STEP_COUNT}`}
    >
      {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, index) => index + 1).map((step) => (
        <span
          key={step}
          className={
            step <= current
              ? "h-1.5 flex-1 rounded-full bg-action"
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
