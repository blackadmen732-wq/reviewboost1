import { isValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";

/**
 * The client's own check on the destination it is about to send someone to.
 *
 * The server validates before serving, so this is the second lock rather than
 * the first: it is what stops a compromised or mis-deployed API from using a
 * customer's browser as a redirector. The rules mirror the server's and the
 * database's exactly.
 */

export const DESTINATION_PROVIDERS = ["google"] as const;

export type DestinationProvider = (typeof DESTINATION_PROVIDERS)[number];

export interface Destination {
  provider: DestinationProvider;
  url: string;
}

export function isDestinationProvider(value: unknown): value is DestinationProvider {
  return typeof value === "string" && (DESTINATION_PROVIDERS as readonly string[]).includes(value);
}

export function isValidatedDestination(provider: unknown, url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
  if (!isDestinationProvider(provider)) return false;

  switch (provider) {
    case "google":
      return isValidatedGoogleReviewUrl(url);
  }
}

export function requireValidatedDestination(destination: {
  provider: string;
  url: string;
}): Destination {
  if (!isValidatedDestination(destination.provider, destination.url)) {
    throw new UnvalidatedDestinationError();
  }
  return { provider: destination.provider as DestinationProvider, url: destination.url };
}

class UnvalidatedDestinationError extends Error {
  readonly code = "invalid_destination";

  constructor() {
    super("The API returned a destination that does not validate.");
    this.name = "UnvalidatedDestinationError";
  }
}
