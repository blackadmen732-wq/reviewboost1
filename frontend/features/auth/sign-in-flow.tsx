"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/ui/code-input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Sign in, in two taps and no password.
 *
 * Login and Get started are the same door. Verify is the code on the next
 * screen. No Wordmark here — the page chrome already shows ReviewBoostLogo.
 */

type Step = "email" | "verify";

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

  const sendCode = useCallback(async (address: string) => {
    setBusy(true);
    setError(null);

    const { error: sendError } = await supabaseBrowser().auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });

    setBusy(false);

    if (sendError) {
      setError("We could not send the code. Check the address and try again.");
      return;
    }

    setStep("verify");
    setSecondsLeft(RESEND_SECONDS);
  }, []);

  async function handleEmailSubmit(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();

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
        setResetToken((value) => value + 1);
        return;
      }

      window.location.assign(next);
    },
    [email, next],
  );

  if (step === "verify") {
    return (
      <div className="flex flex-col gap-8" data-auth-step="verify">
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

        <div className="flex flex-col gap-3">
          <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.02em] text-ink">
            Check your email
          </h1>
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

        <div className="flex flex-col gap-3">
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

          <p className="max-w-[30ch] text-sm leading-relaxed text-muted">
            Not there? Check your spam folder.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleEmailSubmit}
      className="flex flex-col gap-8"
      noValidate
      data-auth-step="login"
    >
      <div className="flex flex-col gap-3">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Sign in
        </h1>
        <p className="text-base leading-relaxed text-muted">
          Customers scan a code on your counter. You get more reviews — from
          everyone who rates you.
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

      <Button type="submit" variant="action" size="lg" loading={busy} loadingLabel="Sending…">
        Continue
      </Button>

      <p className="text-sm leading-relaxed text-muted">
        By continuing you agree to our{" "}
        <a
          href="/privacy"
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          privacy policy
        </a>
        .
      </p>
    </form>
  );
}
