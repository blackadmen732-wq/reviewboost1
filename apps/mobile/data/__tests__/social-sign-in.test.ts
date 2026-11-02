import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign in with Apple and Google on the iPhone.
 *
 * The App Store rule this file guards is 4.8: Google is never offered unless
 * Sign in with Apple is offered too, on this device. It also pins the Apple
 * handshake: the hashed nonce goes to Apple, the raw nonce to Supabase, and
 * the authorization code to our server so deletion can revoke it later.
 */

let appleAvailable = true;
const signInAsync = vi.fn();
const signInWithIdToken = vi.fn(async (_args: unknown) => ({ error: null as null | { message: string } }));
const accountFetch = vi.fn(async (_path: string, _init: unknown) => ({}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-apple-authentication", () => ({
  isAvailableAsync: async () => appleAvailable,
  signInAsync: (args: unknown) => signInAsync(args),
  AppleAuthenticationScope: { EMAIL: 1, FULL_NAME: 0 },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "raw-nonce-1",
  digestStringAsync: async (_algorithm: unknown, value: string) => `sha256(${value})`,
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `reviewboost://${path}` }));
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock("../api", () => ({ accountFetch: (path: string, init: unknown) => accountFetch(path, init) }));
vi.mock("../supabase", () => ({
  supabase: { auth: { signInWithIdToken: (args: unknown) => signInWithIdToken(args) } },
}));

import {
  availableSocialProviders,
  parseSocialProviders,
  signInWithApple,
  tokensFromRedirect,
} from "../social-sign-in";

beforeEach(() => {
  appleAvailable = true;
  signInAsync.mockReset();
  signInWithIdToken.mockClear();
  accountFetch.mockClear();
  process.env.EXPO_PUBLIC_AUTH_PROVIDERS = "google,apple";
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_AUTH_PROVIDERS;
});

describe("which buttons show", () => {
  it("shows only listed providers, Apple first", () => {
    expect(parseSocialProviders(undefined)).toEqual([]);
    expect(parseSocialProviders("google,apple")).toEqual(["apple", "google"]);
    expect(parseSocialProviders("apple")).toEqual(["apple"]);
  });

  it("never offers Google without Sign in with Apple (Guideline 4.8)", async () => {
    expect(parseSocialProviders("google")).toEqual([]);
    appleAvailable = false;
    expect(await availableSocialProviders()).toEqual([]);
  });

  it("offers both when Apple sign-in works on this iPhone", async () => {
    expect(await availableSocialProviders()).toEqual(["apple", "google"]);
  });
});

describe("Sign in with Apple", () => {
  it("sends the hashed nonce to Apple and the raw one to Supabase, then keeps the code for revocation", async () => {
    signInAsync.mockResolvedValue({ identityToken: "id-token", authorizationCode: "auth-code" });

    expect(await signInWithApple()).toEqual({ kind: "signedIn" });
    expect(signInAsync).toHaveBeenCalledWith({ requestedScopes: [1], nonce: "sha256(raw-nonce-1)" });
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: "apple", token: "id-token", nonce: "raw-nonce-1" });
    expect(accountFetch).toHaveBeenCalledWith(
      "/api/v1/account/apple-sign-in",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ authorizationCode: "auth-code" }) }),
    );
  });

  it("treats closing Apple's sheet as a quiet cancel", async () => {
    signInAsync.mockRejectedValue(Object.assign(new Error("cancelled"), { code: "ERR_REQUEST_CANCELED" }));
    expect(await signInWithApple()).toEqual({ kind: "cancelled" });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });
});

describe("the Google redirect", () => {
  it("reads the session from the fragment", () => {
    expect(tokensFromRedirect("reviewboost://auth/callback#access_token=a1&refresh_token=r1&token_type=bearer")).toEqual({
      accessToken: "a1",
      refreshToken: "r1",
    });
  });

  it("finds nothing in an error redirect", () => {
    expect(tokensFromRedirect("reviewboost://auth/callback?error=access_denied")).toBeNull();
  });
});
