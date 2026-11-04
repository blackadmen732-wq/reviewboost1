"use client";

import { useState } from "react";

import { InlineNotice } from "@/components/ui/inline-notice";
import { PROVIDER_LABEL, type SignInProvider } from "@/lib/auth/sign-in-providers";
import { loadSupabaseBrowser } from "@/lib/supabase/lazy-browser";
import { cn } from "@/lib/utils/cn";

/**
 * "Continue with Google" and "Continue with Apple", under the email form.
 *
 * Each button hands off to Supabase, which sends the person to Google or
 * Apple and back to /auth/callback, where the session is set and they land on
 * `next`. The same door as the email code: a new person gets an account and
 * goes to setup, a returning one goes to Home.
 *
 * Styling follows each company's rules rather than ours: Apple's white-outline
 * button with the Apple logo, Google's light button with the four-colour G,
 * both the same size as the email button so neither is less prominent (App
 * Store Review Guideline 4.8, Apple HIG; Google identity branding guidelines).
 */
export function SocialSignIn({
  next,
  providers,
}: {
  next: string;
  providers: readonly SignInProvider[];
}) {
  const [pending, setPending] = useState<SignInProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) return null;

  async function start(provider: SignInProvider) {
    setPending(provider);
    setError(null);

    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next);
    callback.searchParams.set("provider", provider);

    try {
      const { error: startError } = await (await loadSupabaseBrowser()).auth.signInWithOAuth({
        provider,
        options:
          provider === "apple"
            ? // Email only: the name is never needed, and asking for less is
              // what Apple's privacy rules reward.
              { redirectTo: callback.toString(), scopes: "email" }
            : { redirectTo: callback.toString(), queryParams: { prompt: "select_account" } },
      });
      if (startError) throw startError;
      // Success navigates away; the pending state stays until it does.
    } catch {
      setPending(null);
      setError(
        `${provider === "apple" ? "Apple" : "Google"} sign-in isn't available right now. Use your email instead.`,
      );
    }
  }

  return (
    <div className="flex flex-col gap-3" data-social-sign-in>
      <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => void start(provider)}
          disabled={pending !== null}
          aria-busy={pending === provider}
          data-sign-in-provider={provider}
          className={cn(
            "inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-[16px] border px-6 text-[1.0625rem] font-medium",
            "transition-opacity focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
            "disabled:cursor-default disabled:opacity-60",
            provider === "apple"
              ? "border-[color:var(--rb-signin-apple-border)] bg-[color:var(--rb-signin-apple-bg)] text-[color:var(--rb-signin-apple-fg)]"
              : "border-[color:var(--rb-signin-google-border)] bg-[color:var(--rb-signin-google-bg)] text-[color:var(--rb-signin-google-fg)]",
          )}
        >
          {provider === "apple" ? <AppleLogo /> : <GoogleLogo />}
          <span>{pending === provider ? "Opening…" : PROVIDER_LABEL[provider]}</span>
        </button>
      ))}

      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 814 1000" className="h-5 w-4 shrink-0" aria-hidden="true" fill="currentColor">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}
