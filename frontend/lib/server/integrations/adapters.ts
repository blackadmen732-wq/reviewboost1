import "server-only";

import { createFakeAdapter } from "@/lib/server/integrations/providers/fake/adapter";
import { createSquareAdapter } from "@/lib/server/integrations/providers/square/adapter";
import { squareConfig } from "@/lib/server/integrations/providers/square/config";
import { fakeProviderEnabled } from "@/lib/server/integrations/registry";
import type { ProviderAdapter } from "@/lib/server/integrations/types";

/**
 * The adapter for a provider, or null when none exists in this environment.
 * Square has one only where its application is configured (see
 * providers/square/config.ts); the test provider only where it is switched on.
 */
export function getAdapter(providerId: string): ProviderAdapter | null {
  if (providerId === "fake" && fakeProviderEnabled()) return createFakeAdapter();
  if (providerId === "square") {
    const config = squareConfig();
    return config ? createSquareAdapter({ config }) : null;
  }
  return null;
}
