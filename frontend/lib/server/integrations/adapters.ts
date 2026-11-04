import "server-only";

import { createFakeAdapter } from "@/lib/server/integrations/providers/fake/adapter";
import { fakeProviderEnabled } from "@/lib/server/integrations/registry";
import type { ProviderAdapter } from "@/lib/server/integrations/types";

/**
 * The adapter for a provider, or null when none exists in this environment.
 * Square's adapter arrives in stage 2; until then only the test provider has
 * one, and only where it is switched on.
 */
export function getAdapter(providerId: string): ProviderAdapter | null {
  if (providerId === "fake" && fakeProviderEnabled()) return createFakeAdapter();
  return null;
}
