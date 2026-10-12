"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/ui/code-input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { OAuthButtons } from "@/features/auth/oauth-buttons";
import {
  OAUTH_ERROR_MESSAGES,
  type OAuthErrorCode,
  type OAuthProvider,
  oauthRedirectTo,
} from "@/lib/auth/oauth-providers";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Sign in, in two taps and no password.
 *
 * Login and Get started are the same door. Verify is the code on the next
 * screen. No Wordmark here — the page chrome already shows ReviewBoostLogo.
 *
 * Apple and Google sit under the email door as equal alternatives, only when
 * they are switched on. They go through Supabase Auth (PKCE) and come back via
 * /auth/callback to the same `next`, so the session, the business membership
 * and every role check are the same whichever door was used.
 */

type Step = "email" | "verify";

const RESEND_SECONDS = 30;

export function SignInFlow({
  next,
  intent = "signin",
  providers = [],
  oauthError = null,
  cancelHref = "/",
}: {
  next: string;
  intent?: "signin" | "start";
  /** Providers that are configured and switched on. Empty: email only. */
  providers?: readonly OAuthProvider[];
  /** Why the last Apple/Google attempt came back to this page, if it did. */
  oauthError?: OAuthErrorCode | null;
  /** Where Cancel goes. */
  cancelHref?: string;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A cancelled Apple/Google sheet is information, not an error.
  const [providerNotice, setProviderNotice] = useState<{ text: string; calm: boolean } | null>(
    oauthError ? { text: OAUTH_ERROR_MESSAGES[oauthError], calm: oauthError === "cancelled" } : null,
  );
  const [opening, setOpening] = useState<OAuthProvider | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const emailField = useRef<HTMLInputElement>(null);

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
      const { error: sendError } = await supabaseBrowser().auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      });
      if (sendError) {
        setError(
          "We could not send the code. Check the address and try again.",
        );
        return;
      }
      setStep("verify");
      setSecondsLeft(RESEND_SECONDS);
    } catch {
      setError(
        "Could not reach ReviewBoost. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  async function continueWith(provider: OAuthProvider) {
    setOpening(provider);
    setError(null);
    setProviderNotice(null);
    try {
      // On success the browser leaves for Apple or Google; nothing after this
      // line runs. Only a refusal to start comes back here.
      const { error: oauthStartError } = await supabaseBrowser().auth.signInWithOAuth({
        provider,
        options: { redirectTo: oauthRedirectTo(window.location.origin, next) },
      });
      if (oauthStartError) {
        setProviderNotice({ text: OAUTH_ERROR_MESSAGES.failed, calm: false });
        setOpening(null);
      }
    } catch {
      setProviderNotice({
        text: "Could not reach ReviewBoost. Check your connection and try again.",
        calm: false,
      });
      setOpening(null);
    }
  }

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

      try {
        const { error: verifyError } = await supabaseBrowser().auth.verifyOtp({
          email,
          token: code,
          type: "email",
        });
        if (verifyError) {
          setError("That code is not right. Check it and type it again.");
          setResetToken((value) => value + 1);
          return;
        }
        window.location.assign(next);
      } catch {
        setError(
          "Could not reach ReviewBoost. Check your connection and try again.",
        );
        setResetToken((value) => value + 1);
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

  const locked = busy || opening !== null;

  return (
    <form
      onSubmit={handleEmailSubmit}
      className="flex flex-col gap-6"
      noValidate
      data-auth-step="login"
      data-auth-intent={intent}
    >
      <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {intent === "start" ? "Get started" : "Sign in"}
        </h1>
        <a
          href={cancelHref}
          className="-mr-2 inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-2 text-base font-medium text-brand-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          Cancel
        </a>
      </div>

      {providerNotice ? (
        <InlineNotice kind={providerNotice.calm ? "info" : "error"} blocking={!providerNotice.calm}>
          {providerNotice.text}
        </InlineNotice>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email address
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
          autoFocus={providers.length === 0}
          placeholder="you@yourbusiness.com"
          value={email}
          disabled={opening !== null}
          aria-describedby="email-hint"
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
        />
        <p id="email-hint" className="text-sm text-muted">
          We’ll email you a 6-digit code. No password.
        </p>
        {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </div>

      <Button
        type="submit"
        variant="action"
        loading={busy}
        loadingLabel="Sending…"
        disabled={opening !== null}
      >
        Continue
      </Button>

      {providers.length > 0 ? (
        <>
          <div className="flex items-center gap-4" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-sm text-muted">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <OAuthButtons
            providers={providers}
            busy={opening}
            disabled={locked}
            onSelect={(provider) => void continueWith(provider)}
          />
        </>
      ) : null}

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
