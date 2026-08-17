"use client";

import { ArrowLeft, Check, Mail } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/ui/code-input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Sign in, in two taps and no password.
 *
 * There is one field on screen at a time and one button under it. Every extra
 * choice is a place where a busy owner stops, and the cost of stopping is that
 * they never come back.
 *
 * Deliberately absent: a password field, a "create account" link, a "remember
 * me" checkbox, and terms copy above the button. Signing in and signing up are
 * the same action here — if the email is new, an account is created. Asking
 * someone to know which of two doors they belong to is a decision that serves
 * the database, not them.
 */

type Step = "email" | "code";

const RESEND_SECONDS = 30;

export function SignInFlow({ next }: { next: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const emailField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  const sendCode = useCallback(
    async (address: string) => {
      setBusy(true);
      setError(null);

      const { error: sendError } = await supabaseBrowser().auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      });

      setBusy(false);

      if (sendError) {
        // Never surfaces the provider's wording, which is written for
        // developers and often mentions rate limits or internal states.
        setError("We could not send the code. Check the address and try again.");
        return;
      }

      setStep("code");
      setSecondsLeft(RESEND_SECONDS);
    },
    [],
  );

  async function handleEmailSubmit(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();

    // Deliberately loose. A stricter pattern rejects real addresses, and the
    // authoritative test is whether the code arrives.
    if (!address.includes("@") || address.length < 5) {
      setError("That does not look like an email address.");
      emailField.current?.focus();
      return;
    }

    setEmail(address);
    await sendCode(address);
  }

  const handleCode = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);

      const { error: verifyError } = await supabaseBrowser().auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });

      if (verifyError) {
        setBusy(false);
        setError("That code is not right. Check it and type it again.");
        // Clears the boxes and refocuses, so the next attempt needs no tidying
        // up first.
        setResetToken((value) => value + 1);
        return;
      }

      // A full navigation rather than a client push, so every Server Component
      // re-renders with the new session already in place.
      window.location.assign(next);
    },
    [email, next],
  );

  if (step === "code") {
    return (
      <div className="flex flex-col gap-8">
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setError(null);
          }}
          className="-ml-2 inline-flex w-fit items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>

        <div className="flex flex-col gap-3 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-brand-soft">
            <Mail className="size-8 text-brand-text" aria-hidden="true" />
          </div>
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">
            Check your email
          </h1>
          {/* The address is repeated because the most common failure here is a
              typo two screens ago, and seeing it is faster than going back. */}
          <p className="text-base text-muted">
            We sent a 6-digit code to
            <br />
            <span className="font-semibold text-ink">{email}</span>
          </p>
        </div>

        <CodeInput
          label="6-digit code from your email"
          disabled={busy}
          onComplete={handleCode}
          resetToken={resetToken}
        />

        {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}

        <div className="flex flex-col items-center gap-3">
          {secondsLeft > 0 ? (
            <p className="text-sm text-muted" aria-live="polite">
              Send again in {secondsLeft}s
            </p>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-auto"
              loading={busy}
              onClick={() => void sendCode(email)}
            >
              Send it again
            </Button>
          )}

          {/* The single most common reason someone gets stuck here, said before
              they conclude it is broken and close the tab. A first message from
              a new sender lands in spam often enough that not mentioning it
              costs real signups. */}
          <p className="max-w-[30ch] text-center text-sm leading-relaxed text-muted">
            Not there? Check your spam folder.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleEmailSubmit} className="flex flex-col gap-8" noValidate>
      {/* The brand comes first, because someone landing here cold — or an owner
          handed a phone mid-demo — needs to know what this is before they type
          anything into it. */}
      <div className="flex flex-col gap-3">
        <Wordmark size="lg" />
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink">
          More Google reviews, without the work
        </h1>
        {/* One sentence, concrete, no adjectives. A busy owner reads exactly
            this much before deciding whether to continue. */}
        <p className="text-base leading-relaxed text-muted">
          Customers scan a code on your counter. You get more reviews.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <label htmlFor="email" className="text-base font-medium text-ink">
          Email
        </label>
        <Input
          ref={emailField}
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder="you@yourbusiness.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          className="h-16 text-lg"
        />
        {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </div>

      <Button type="submit" size="lg" loading={busy} loadingLabel="Sending…">
        Continue
      </Button>

      {/* Three facts that answer what a skeptical owner is actually thinking:
          is this a commitment, do I have to learn something, and is it going to
          cost me. Stated flatly — no ticks, no badges, no "trusted by 10,000
          businesses" nobody believes. */}
      <ul className="flex flex-col gap-2.5">
        {[
          "No password to remember",
          "Set up in about two minutes",
          "Nothing to install for your customers",
        ].map((fact) => (
          <li key={fact} className="flex items-center gap-2.5 text-sm text-muted">
            <Check className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
            {fact}
          </li>
        ))}
      </ul>

      {/* Below the button, small, and not a checkbox. Nobody is blocked by it,
          and pretending a tick box means informed consent helps no one. */}
      <p className="text-center text-sm leading-relaxed text-muted">
        By continuing you agree to our terms and privacy policy.
      </p>
    </form>
  );
}
