import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { ConfigError } from "@/lib/server/env";
import type { TokenSet } from "@/lib/server/integrations/types";

/**
 * Provider tokens at rest (docs/connections/04 §4.5).
 *
 * Its own key, `INTEGRATION_CREDENTIAL_KEY`, separate from the key that
 * protects customer notes, so a leak of one does not expose the other. The key
 * version travels in every ciphertext, and `INTEGRATION_CREDENTIAL_KEY_PREVIOUS`
 * keeps older rows readable during a rotation.
 *
 * Every ciphertext is bound, as GCM additional data, to the organization,
 * provider and provider account it belongs to. A token copied onto another
 * business's row does not decrypt there. (The design names the connection id;
 * the account triple is used instead because it is known before the row
 * exists and, with at most one live connection per account, binds as tightly.)
 *
 * Tokens leave this module only toward the provider. They are never returned
 * by an API, put in a URL, logged, or stored in a browser.
 */

const ALGORITHM = "aes-256-gcm";
const PREFIX = "ic1";
const IV_BYTES = 12;

export interface CredentialBinding {
  orgId: string;
  providerId: string;
  externalAccountId: string;
}

function decodeKey(name: string, raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new ConfigError(`${name} must be a base64-encoded 32-byte key. Generate one with: openssl rand -base64 32`);
  }
  return key;
}

export function credentialKeyVersion(): number {
  const raw = process.env.INTEGRATION_CREDENTIAL_KEY_VERSION?.trim();
  if (!raw) return 1;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1 || version > 32767) {
    throw new ConfigError("INTEGRATION_CREDENTIAL_KEY_VERSION must be an integer between 1 and 32767.");
  }
  return version;
}

function currentKey(): Buffer {
  const raw = process.env.INTEGRATION_CREDENTIAL_KEY?.trim();
  if (!raw) throw new ConfigError("INTEGRATION_CREDENTIAL_KEY is required to store provider credentials.");
  return decodeKey("INTEGRATION_CREDENTIAL_KEY", raw);
}

function keyForVersion(version: number): Buffer {
  if (version === credentialKeyVersion()) return currentKey();
  const raw = process.env.INTEGRATION_CREDENTIAL_KEY_PREVIOUS?.trim();
  if (!raw) throw new ConfigError(`No key is configured for credential key version ${version}.`);
  return decodeKey("INTEGRATION_CREDENTIAL_KEY_PREVIOUS", raw);
}

function aad(binding: CredentialBinding): Buffer {
  return Buffer.from(`${binding.orgId}|${binding.providerId}|${binding.externalAccountId}`, "utf8");
}

export function sealCredential(plaintext: string, binding: CredentialBinding): string {
  const version = credentialKeyVersion();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, currentKey(), iv);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    PREFIX,
    String(version),
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function openCredential(sealed: string, binding: CredentialBinding): string {
  const parts = sealed.split(":");
  if (parts.length !== 5 || parts[0] !== PREFIX) throw new Error("Credential ciphertext is malformed.");
  const [, versionRaw, iv, tag, ciphertext] = parts as [string, string, string, string, string];
  const version = Number(versionRaw);
  if (!Number.isInteger(version)) throw new Error("Credential ciphertext is malformed.");

  const decipher = createDecipheriv(ALGORITHM, keyForVersion(version), Buffer.from(iv, "base64"));
  decipher.setAAD(aad(binding));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** The columns `rpc_integration_store_credentials` and friends take. */
export interface SealedTokens {
  keyVersion: number;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
}

export function sealTokens(tokens: TokenSet, binding: CredentialBinding): SealedTokens {
  return {
    keyVersion: credentialKeyVersion(),
    accessTokenEnc: sealCredential(tokens.accessToken, binding),
    refreshTokenEnc: tokens.refreshToken ? sealCredential(tokens.refreshToken, binding) : null,
    accessExpiresAt: tokens.accessExpiresAt ? tokens.accessExpiresAt.toISOString() : null,
    refreshExpiresAt: tokens.refreshExpiresAt ? tokens.refreshExpiresAt.toISOString() : null,
  };
}

export interface CredentialRow {
  access_token_enc: string;
  refresh_token_enc: string | null;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  last_refreshed_at: string | null;
}

export function openTokens(
  row: CredentialRow,
  binding: CredentialBinding,
  grantedScopes: readonly string[],
): TokenSet {
  return {
    accessToken: openCredential(row.access_token_enc, binding),
    refreshToken: row.refresh_token_enc ? openCredential(row.refresh_token_enc, binding) : null,
    accessExpiresAt: row.access_expires_at ? new Date(row.access_expires_at) : null,
    refreshExpiresAt: row.refresh_expires_at ? new Date(row.refresh_expires_at) : null,
    grantedScopes,
  };
}
