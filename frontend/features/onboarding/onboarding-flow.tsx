"use client";

import { Card } from "@/components/ui/card";
import { ArrowLeft, Check, Download, ExternalLink, Printer, RefreshCw, Store } from "lucide-react";
import { useState } from "react";

import { PUBLIC_PLANS } from "@/features/public/pricing-plans";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { TestGoogleLinkButton } from "@/features/dashboard/google-link-care";
import {
  GOOGLE_LINK_BLAST,
  GOOGLE_LINK_LATER,
} from "@/features/dashboard/google-link-copy";
import { useAuthenticatedQr } from "@/lib/hooks/use-authenticated-qr";
import { isGoogleReviewWritingUrl } from "@/lib/security/google-review-url";
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

interface Created {
  standUrl: string;
  standId: string;
}

export function OnboardingFlow({ chosenPlan = null }: { chosenPlan?: string | null }) {
  const chosenPlanName = PUBLIC_PLANS.find((plan) => plan.id === chosenPlan)?.name ?? null;
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const qr = useAuthenticatedQr(created?.standId ?? null);

  const trimmedUrl = googleUrl.trim();
  const urlLooksRight = trimmedUrl !== "" && isGoogleReviewWritingUrl(trimmedUrl);

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
    setBusy(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();

      if (!session) {
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

      if (!response.ok) {
        setError(
          response.status === 409
            ? "That name is already taken. Try adding your street or city."
            : "Something went wrong. Please try again.",
        );
        return;
      }

      const body = (await response.json()) as { data: Created };
      setCreated(body.data);
      setStep("done");
    } catch {
      setError("Could not reach ReviewBoost. Check your connection and try again.");
    } finally {
      setBusy(false);
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
          <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.03em] text-ink">
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
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            className="h-16 text-lg"
          />
          {urlLooksRight ? <TestGoogleLinkButton url={trimmedUrl} /> : null}

          {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        </div>

        <Button
          size="lg"
          disabled={name.trim().length < 2}
          onClick={() => {
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
          <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.03em] text-ink">
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
          {[
            "Open your business on Google",
            "Tap “Ask for reviews”",
            "Copy the link and paste it below",
          ].map((instruction, index) => (
            <li key={instruction} className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-sm font-bold text-ink">
                {index + 1}
              </span>
              <span className="pt-0.5 text-base text-ink">{instruction}</span>
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
            <p className="flex items-center gap-2 text-sm font-medium text-brand-text">
              <Check className="size-4" aria-hidden="true" />
              That is the right link
            </p>
          ) : null}

          {trimmedUrl !== "" && !urlLooksRight ? (
            <InlineNotice kind="error">
              That does not look like a Google link. It should start with
              g.page or google.com.
            </InlineNotice>
          ) : null}

          {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        </div>

        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            loading={busy}
            loadingLabel="Setting up…"
            disabled={!urlLooksRight}
            onClick={() => void finish(trimmedUrl)}
          >
            Continue
          </Button>

          {/* Always available. The person who cannot find this link today is
              exactly the person who must not be locked out today. */}
          <Button variant="ghost" loading={busy} onClick={() => void finish(undefined)}>
            I will do this later
          </Button>
          <p className="text-sm text-muted" data-google-unset="true">
            {GOOGLE_LINK_LATER}
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ step 3 -----

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-brand-soft">
        <Check className="size-10 text-brand-text" strokeWidth={3} aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.03em] text-ink">
          Your Tag is ready
        </h1>
        {/* It is not working yet, and saying "you are all set" would mean a
            business puts this on the counter and finds out from a customer.
            The door opens when a plan does. */}
        <p className="text-base text-muted">
          Choose a plan to switch it on. Starter is free for seven days,
          and nothing is charged until the trial ends.
        </p>
      </div>

      {created ? (
        <Card className="w-full">
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
        </Card>
      ) : null}

      <div className="flex w-full flex-col gap-3">
        {/* The plan this person picked on the pricing page, if they came that
            way. Naming it here is the difference between "you are nearly
            done" and "choose again" — they already chose, on the page that
            made them sign up. Nothing is charged by arriving: Billing marks
            the plan and still waits for a deliberate click. */}
        <Button size="lg" asChild>
          <a href={chosenPlan ? `/settings/billing?plan=${chosenPlan}` : "/settings/billing"}>
            {chosenPlanName ? `Continue with ${chosenPlanName}` : "Choose a plan"}
          </a>
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
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
        <Button variant="ghost" asChild>
          <a href="/home">Go to my dashboard</a>
        </Button>
      </div>
    </div>
  );
}

function Progress({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`Step ${current} of 3`}>
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
