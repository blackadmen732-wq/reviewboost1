import "server-only";

import { createPrivateKey, sign } from "node:crypto";

import { decrypt, encrypt } from "@/lib/server/crypto";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Sign in with Apple token revocation.
 *
 * Apple requires an app that offers Sign in with Apple to revoke the person's
 * tokens through its REST API when they delete their account (App Store Review
 * Guideline 5.1.1(v)). Supabase signs the person in but never revokes, so we
 * keep the one refresh token Apple issues at first sign-in, encrypted, and
 * present it to Apple's revoke endpoint during account deletion.
 *
 * Nothing else is done with the token. ReviewBoost never reads Apple data with
 * it; the email Supabase stores at sign-in is the only Apple data we hold.
 *
 * Configuration (all server-only; unset means revocation is off and every
 * function here is a logged no-op, never an error in someone's sign-in):
 *   APPLE_TEAM_ID              10-character Apple Developer team ID
 *   APPLE_SIGN_IN_KEY_ID       Key ID of the "Sign in with Apple" key
 *   APPLE_SIGN_IN_PRIVATE_KEY  that key's .p8 contents (PEM; "\n" escapes allowed)
 *   APPLE_BUNDLE_ID            the iPhone app's client ID (default fit.reviewboost.app)
 *   APPLE_SERVICES_ID          the website's Services ID, for web sign-ins
 */

const APPLE_AUDIENCE = "https://appleid.apple.com";
const TOKEN_URL = "https://appleid.apple.com/auth/token";
const REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const REQUEST_TIMEOUT_MS = 10_000;

interface AppleKeyConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function keyConfig(): AppleKeyConfig | null {
  const teamId = env("APPLE_TEAM_ID");
  const keyId = env("APPLE_SIGN_IN_KEY_ID");
  const privateKey = env("APPLE_SIGN_IN_PRIVATE_KEY");
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey: privateKey.replace(/\\n/g, "\n") };
}

export function appleRevocationConfigured(): boolean {
  return keyConfig() !== null;
}

/** The iPhone app's Apple client ID. */
export function appleBundleId(): string {
  return env("APPLE_BUNDLE_ID") ?? "fit.reviewboost.app";
}

/** The website's Apple Services ID, or null when web Sign in with Apple is not set up. */
export function appleServicesId(): string | null {
  return env("APPLE_SERVICES_ID");
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * The client secret Apple expects: an ES256 JWT signed with the Sign in with
 * Apple key. Minted per request and short-lived; Apple allows up to six months.
 */
export function appleClientSecret(clientId: string, config: AppleKeyConfig, now = Date.now()): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }));
  const issuedAt = Math.floor(now / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: config.teamId,
      iat: issuedAt,
      exp: issuedAt + 300,
      aud: APPLE_AUDIENCE,
      sub: clientId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(config.privateKey),
    // JWS wants the raw r||s pair, not DER.
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
}

/**
 * Exchange the one-time authorization code the iPhone app receives from
 * Apple for a refresh token, and keep it for revocation. Returns whether a
 * token is now stored. Failure never blocks sign-in: the person is already
 * signed in, and the cost is only that deletion cannot revoke with Apple.
 */
export async function keepAppleTokenFromCode(
  userId: string,
  authorizationCode: string,
  clientId: string,
  requestId: string,
): Promise<boolean> {
  const config = keyConfig();
  if (!config) {
    logger.warn("apple.revocation_not_configured", { requestId });
    return false;
  }

  let response: Response;
  try {
    response = await postForm(TOKEN_URL, {
      client_id: clientId,
      client_secret: appleClientSecret(clientId, config),
      code: authorizationCode,
      grant_type: "authorization_code",
    });
  } catch (error) {
    logger.warn("apple.code_exchange_unreachable", { requestId, error: String(error) });
    return false;
  }

  if (!response.ok) {
    logger.warn("apple.code_exchange_failed", { requestId, status: response.status });
    return false;
  }

  const body = (await response.json().catch(() => null)) as { refresh_token?: unknown } | null;
  const refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : null;
  if (!refreshToken) {
    logger.warn("apple.code_exchange_no_refresh_token", { requestId });
    return false;
  }

  return keepAppleRefreshToken(userId, refreshToken, clientId, requestId);
}

/** Keep a refresh token already obtained (the web flow, where Supabase did the exchange). */
export async function keepAppleRefreshToken(
  userId: string,
  refreshToken: string,
  clientId: string,
  requestId: string,
): Promise<boolean> {
  const ciphertext = encrypt(refreshToken);
  if (!ciphertext) return false;

  const { error } = await serviceRoleClient().rpc("rpc_apple_sign_in_token_store", {
    p_user_id: userId,
    p_client_id: clientId,
    p_refresh_token_enc: ciphertext,
  });
  if (error) {
    logger.warn("apple.token_store_failed", { requestId, error: error.message });
    return false;
  }
  return true;
}

/**
 * Revoke the person's Sign in with Apple authorization, if we hold a token for
 * them. Called during account deletion, before the login itself is removed.
 * Returns what happened, for the log; it never throws, because a person's
 * right to delete their account does not depend on Apple answering.
 */
export async function revokeAppleSignIn(
  userId: string,
  requestId: string,
): Promise<"revoked" | "none" | "not_configured" | "failed"> {
  // A failure here must never stop the deletion it runs inside, so even a
  // thrown network error comes back as "failed".
  let data: unknown;
  try {
    const result = await serviceRoleClient().rpc("rpc_apple_sign_in_token_take", {
      p_user_id: userId,
    });
    if (result.error) {
      logger.warn("apple.token_take_failed", { requestId, error: result.error.message });
      return "failed";
    }
    data = result.data;
  } catch (caught) {
    logger.warn("apple.token_take_failed", { requestId, error: String(caught) });
    return "failed";
  }

  const row = Array.isArray(data)
    ? (data[0] as { client_id?: string; refresh_token_enc?: string } | undefined)
    : undefined;
  if (!row?.client_id || !row.refresh_token_enc) return "none";

  const config = keyConfig();
  if (!config) {
    logger.warn("apple.revocation_not_configured", { requestId });
    return "not_configured";
  }

  let token: string | null;
  try {
    token = decrypt(row.refresh_token_enc);
  } catch {
    logger.warn("apple.token_decrypt_failed", { requestId });
    return "failed";
  }
  if (!token) return "none";

  try {
    const response = await postForm(REVOKE_URL, {
      client_id: row.client_id,
      client_secret: appleClientSecret(row.client_id, config),
      token,
      token_type_hint: "refresh_token",
    });
    if (!response.ok) {
      logger.warn("apple.revoke_failed", { requestId, status: response.status });
      return "failed";
    }
  } catch (caught) {
    logger.warn("apple.revoke_unreachable", { requestId, error: String(caught) });
    return "failed";
  }

  logger.info("apple.revoked", { requestId });
  return "revoked";
}
