/**
 * Which "Continue with …" buttons the sign-in page shows.
 *
 * Read from NEXT_PUBLIC_AUTH_PROVIDERS, a comma list ("google,apple"). A button
 * only works once that provider is switched on in Supabase (Authentication →
 * Providers), so the list is opt-in: unset shows email only, and a provider is
 * listed here only after it is set up. Showing a button that answers "not
 * enabled" is the kind of dead control the product does not ship.
 *
 * Google is never shown without Apple. On iPhone, App Store Review Guideline
 * 4.8 requires Sign in with Apple wherever another company's sign-in is
 * offered; keeping the web the same means one rule, not two.
 */

export type SignInProvider = "google" | "apple";

const KNOWN: readonly SignInProvider[] = ["google", "apple"];

export function parseSignInProviders(raw: string | undefined | null): SignInProvider[] {
  const listed = new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is SignInProvider => (KNOWN as readonly string[]).includes(value)),
  );
  if (listed.has("google") && !listed.has("apple")) listed.delete("google");
  return KNOWN.filter((provider) => listed.has(provider));
}

export function signInProviders(): SignInProvider[] {
  return parseSignInProviders(process.env.NEXT_PUBLIC_AUTH_PROVIDERS);
}

export const PROVIDER_LABEL: Record<SignInProvider, string> = {
  google: "Continue with Google",
  apple: "Continue with Apple",
};
