import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

/**
 * A provider's logo, when its official file has been added to
 * `public/connections/logos/<provider id>.svg` (or .png).
 *
 * Logos are each company's own artwork, taken from its brand kit under its
 * terms; they are never redrawn here. Until a file is added, the card shows
 * a plain placeholder mark, so a missing logo never looks like a broken one.
 */
const cache = new Map<string, string | null>();

export function providerLogo(providerId: string): string | null {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(providerId)) return null;
  if (cache.has(providerId)) return cache.get(providerId)!;
  let found: string | null = null;
  for (const ext of ["svg", "png"]) {
    const file = path.join(process.cwd(), "public", "connections", "logos", `${providerId}.${ext}`);
    if (existsSync(file)) {
      found = `/connections/logos/${providerId}.${ext}`;
      break;
    }
  }
  cache.set(providerId, found);
  return found;
}
