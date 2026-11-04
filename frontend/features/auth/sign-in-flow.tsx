"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/ui/code-input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { SocialSignIn } from "@/features/auth/social-sign-in";
import type { SignInProvider } from "@/lib/auth/sign-in-providers";
import { Input } from "@/components/ui/input";
import { loadSupabaseBrowser, warmSupabaseBrowser } from "@/lib/supabase/lazy-browser";

/**
 * Sign in, in two taps and no password.
 *
 * Login and Get started are the same door. Verify is the code on the next
 * screen. No Wordmark here — the page chrome already shows ReviewBoostLogo.
 */

type Step = "email" | "verify";

const NO_CONNECTION = "No connection. Check your signal and try again.";

/**
 * The sign-in service could not be reached (Supabase's AuthRetryableFetchError:
 * a dropped connection, or its own 502–504). Checked by name: importing the
 * helper from supabase-js would put the whole client in this page's first
 * bundle, which loads it lazily on purpose.
 */
function unreachable(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AuthRetryableFetchError";
}

class AuthDeadlineError extends Error {
  constructor() {
    super("That’s taking too long. Check your connection and try again.");
    this.name = "AuthDeadlineError";
  }
}

/**
 * The sign-in service has no deadline of its own, so a request on a dead
 * connection spun forever. After 20 s the owner is told and can try again
 * (a code that arrives late still works; the newest one wins).
 */
function withinAuthDeadline<T>(request: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthDeadlineError()), 20_000);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (caught: unknown) => {
        clearTimeout(timer);
        reject(caught);
      },
    );
  });
}

const RESEND_SECONDS = 30;

export function SignInFlow({
  next,
  intent = "signin",
  providers = [],
  initialError = null,
}: {
  next: string;
  intent?: "signin" | "start";
  /** "Continue with …" buttons under the email form (lib/auth/sign-in-providers). */
  providers?: readonly SignInProvider[];
  /** A message from a sign-in that came back unfinished (/auth/callback). */
  initialError?: string | null;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [resetToken, setResetToken] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const emailField = useRef<HTMLInputElement>(null);

  // Supabase is only needed once a button is pressed; fetch it while the
  // owner is typing rather than before the page can show.
  useEffect(() => warmSupabaseBrowser(), []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setTimeout(
      () => setSecondsLeft((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  const sendCode = useCallback(async (address: string) => {
    setBusy(true);
    setError(null);

    try {
      const { error: sendError } = await withinAuthDeadline(
        (async () =>
          (await loadSupabaseBrowser()).auth.signInWithOtp({
            email: address,
            options: { shouldCreateUser: true },
          }))(),
      );
      if (sendError) {
        // No connection is not a wrong address: say which it is.
        setError(
          unreachable(sendError)
            ? NO_CONNECTION
            : "We could not send the code. Check the address and try again.",
        );
        return;
      }
      setStep("verify");
      setSecondsLeft(RESEND_SECONDS);
    } catch (caught) {
      setError(caught instanceof AuthDeadlineError ? caught.message : NO_CONNECTION);
    } finally {
      setBusy(false);
    }
  }, []);

  async function handleEmailSubmit(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();

    // Something@somewhere.end: "tony@barber" was accepted, and the code
    // went nowhere.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(address)) {
      setError("Check the email address. It needs a dot, like name@shop.com.");
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

      try {
        const { error: verifyError } = await withinAuthDeadline(
          (async () =>
            (await loadSupabaseBrowser()).auth.verifyOtp({
              email,
              token: code,
              type: "email",
            }))(),
        );
        if (verifyError) {
          // Offline, the code was never checked: it is still good, so keep it.
          if (unreachable(verifyError)) {
            setError(`${NO_CONNECTION} Your code still works.`);
            return;
          }
          setError("That code didn’t work. Use the newest code we sent.");
          setResetToken((value) => value + 1);
          return;
        }
        window.location.assign(next);
      } catch (caught) {
        setError(
          caught instanceof AuthDeadlineError
            ? caught.message
            : `${NO_CONNECTION} Your code still works.`,
        );
      } finally {
        setBusy(false);
      }
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
      data-auth-intent={intent}
    >
      <div className="flex flex-col gap-3">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {intent === "start" ? "Get started" : "Sign in"}
        </h1>
        <p className="text-base leading-relaxed text-muted">
          Use your business email. We will send you a code to sign in. No
          password to remember.
          {/* Sign in and Get started are the same door, and the screen says
              so: someone new should not wonder whether they need an account. */}
          {intent === "signin" ? " New here? The same code creates your account." : null}
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

      <Button
        type="submit"
        variant="action"
        size="lg"
        loading={busy}
        loadingLabel="Sending…"
      >
        Continue
      </Button>

      <SocialSignIn next={next} providers={providers} />

      <p className="text-sm leading-relaxed text-muted">
        By continuing you agree to our{" "}
        <a
          href="/terms"
          className="font-medium text-ink underline underline-offset-4 hover:no-underline"
        >
          terms
        </a>{" "}
        and{" "}
        <a
          href="/privacy"
          className="font-medium text-ink underline underline-offset-4 hover:no-underline"
        >
          privacy policy
        </a>
        .
      </p>
    </form>
  );
}
