import "server-only";

import { digestStandToken, digestStandTokenWithPreviousKey, tryDecrypt } from "@/lib/server/crypto";
import { previousTokenDigestKey, tokenDigestKeyVersion } from "@/lib/server/env";

/**
 * Do the keys this deployment holds still open the Tags in the field?
 *
 * Every Tag carries one ReviewBoost link, matched to its row by a digest under
 * TOKEN_DIGEST_KEY (or TOKEN_DIGEST_KEY_PREVIOUS for Tags not yet moved to a
 * rotated key), with a copy saved under CUSTOMER_NOTE_ENCRYPTION_KEY so owners
 * can reprint. A wrong or missing key stops every Tag at once while everything
 * else still looks healthy — so readiness refuses such a deployment and health
 * turns red (`rpc_tag_key_sample`, migration 20261103000200).
 *
 * The check opens real Tags the way a customer's phone does: decrypt the saved
 * copy, digest it exactly as resolution does, compare with what is stored.
 * Problems name variables and key versions, never a value or a token.
 *
 * Throws only what the key accessors throw for a missing or malformed key,
 * which the configuration check already reports by name.
 */

export interface TagKeySample {
  key_version: number;
  tags: number;
  token_encrypted: string | null;
  token_hash: string | null;
}

export function tagKeyProblems(rows: readonly TagKeySample[]): string[] {
  const problems = new Set<string>();
  const current = tokenDigestKeyVersion();
  const previousConfigured = previousTokenDigestKey() !== null;

  const tagsByVersion = new Map<number, number>();
  for (const row of rows) tagsByVersion.set(Number(row.key_version), Number(row.tags));

  for (const [version, tags] of tagsByVersion) {
    if (tags <= 0) continue;
    if (version > current) {
      // A rollback to a build or configuration older than the key the Tags
      // were last moved to.
      problems.add(
        `${tags} Tag(s) use digest key version ${version}, newer than TOKEN_DIGEST_KEY_VERSION ${current}: they would not open`,
      );
    } else if (version < current && !previousConfigured) {
      problems.add(
        `${tags} Tag(s) still use digest key version ${version} and TOKEN_DIGEST_KEY_PREVIOUS is not set: they would not open`,
      );
    }
  }

  for (const row of rows) {
    if (!row.token_encrypted || !row.token_hash) continue;
    const version = Number(row.key_version);
    if (version > current || (version < current && !previousConfigured)) continue; // reported above

    const token = tryDecrypt(row.token_encrypted);
    if (token === null) {
      problems.add(
        "CUSTOMER_NOTE_ENCRYPTION_KEY cannot read the saved Tag links: it is not the key they were saved with",
      );
      continue;
    }

    const digest = version === current ? digestStandToken(token) : digestStandTokenWithPreviousKey(token);
    if (digest !== row.token_hash) {
      problems.add(
        version === current
          ? `TOKEN_DIGEST_KEY is not the key Tags on version ${version} were made with: they would not open`
          : `TOKEN_DIGEST_KEY_PREVIOUS is not the key Tags on version ${version} were made with: they would not open`,
      );
    }
  }

  return [...problems];
}

/** Rows as the RPC returns them; anything else reads as no Tags. */
export function tagKeyRows(data: unknown): TagKeySample[] {
  return Array.isArray(data) ? (data as TagKeySample[]) : [];
}
