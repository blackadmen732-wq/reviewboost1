import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { accountFetch } from "./api";
import { supabase } from "./supabase";

/**
 * "Continue with Apple" and "Continue with Google" on the iPhone.
 *
 * Apple is native (the system sheet, Face ID): the identity token goes to
 * Supabase with a nonce, and the one-time authorization code goes to our
 * server, which keeps a token only so account deletion can revoke it with
 * Apple (Guideline 5.1.1(v)). Google opens Google's own page in an
 * authentication session and comes back to reviewboost://auth/callback.
 *
 * Which buttons show comes from EXPO_PUBLIC_AUTH_PROVIDERS, like the web. Google
 * is never shown without Apple: App Store Review Guideline 4.8.
 */

export type SocialProvider = "google" | "apple";

export type SocialResult = { kind: "signedIn" } | { kind: "cancelled" } | { kind: "failed"; message: string };

const KNOWN: readonly SocialProvider[] = ["apple", "google"];

/** Same rule as the web: listed providers only, and Google needs Apple. */
export function parseSocialProviders(raw: string | undefined | null): SocialProvider[] {
  const listed = new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is SocialProvider => (KNOWN as readonly string[]).includes(value)),
  );
  if (listed.has("google") && !listed.has("apple")) listed.delete("google");
  return KNOWN.filter((provider) => listed.has(provider));
}

/** The buttons this device can actually show. */
export async function availableSocialProviders(): Promise<SocialProvider[]> {
  const listed = parseSocialProviders(process.env.EXPO_PUBLIC_AUTH_PROVIDERS);
  if (!listed.includes("apple")) return listed;
  const appleReady =
    Platform.OS === "ios" && (await AppleAuthentication.isAvailableAsync().catch(() => false));
  // Without Sign in with Apple on this device, Google cannot be offered either.
  return appleReady ? listed : [];
}

const FAILED_APPLE = "Apple sign-in didn't finish. Try again, or use your email.";
const FAILED_GOOGLE = "Google sign-in didn't finish. Try again, or use your email.";

export async function signInWithApple(): Promise<SocialResult> {
  // Apple receives the hash; Supabase checks the token against the raw value.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      // Email only. The name is never needed, and asking for less is the point.
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_REQUEST_CANCELED") return { kind: "cancelled" };
    return { kind: "failed", message: FAILED_APPLE };
  }

  if (!credential.identityToken) return { kind: "failed", message: FAILED_APPLE };

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) return { kind: "failed", message: FAILED_APPLE };

  if (credential.authorizationCode) {
    // Kept only to revoke at account deletion. Never blocks the sign-in.
    void accountFetch("/api/v1/account/apple-sign-in", {
      method: "POST",
      body: JSON.stringify({ authorizationCode: credential.authorizationCode }),
    }).catch(() => undefined);
  }

  return { kind: "signedIn" };
}

/** Tokens come back in the fragment (implicit flow) or, on error, the query. */
export function tokensFromRedirect(url: string): { accessToken: string; refreshToken: string } | null {
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export async function signInWithGoogle(): Promise<SocialResult> {
  const redirectTo = Linking.createURL("auth/callback");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) return { kind: "failed", message: FAILED_GOOGLE };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return { kind: "cancelled" };

  const tokens = tokensFromRedirect(result.url);
  if (!tokens) return { kind: "failed", message: FAILED_GOOGLE };

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (sessionError) return { kind: "failed", message: FAILED_GOOGLE };

  return { kind: "signedIn" };
}
