import "server-only";

/**
 * Square's settings for this environment (docs/connections/appendix-a).
 *
 * Square is connectable only when every one of these is present and they
 * agree with each other. Without them the directory keeps showing Square as
 * "Coming soon" rather than a Connect button that cannot work.
 *
 *   SQUARE_ENVIRONMENT          sandbox (default) or production
 *   SQUARE_APPLICATION_ID       from the Developer Console's OAuth page
 *   SQUARE_APPLICATION_SECRET   the same page; never leaves the server
 *   SQUARE_WEBHOOK_SIGNATURE_KEY from the webhook subscription
 *
 * Sandbox and production application ids look different (`sandbox-sq0idb-…`
 * and `sq0idp-…`), so a production id paired with the sandbox host, or the
 * reverse, is refused here instead of failing at an owner's sign-in. Turning
 * production on is a deliberate setting, never a default.
 */

export type SquareEnvironment = "sandbox" | "production";

export interface SquareConfig {
  environment: SquareEnvironment;
  applicationId: string;
  applicationSecret: string;
  /** Null until a webhook subscription exists; webhooks are refused without it. */
  webhookSignatureKey: string | null;
  /** https://connect.squareupsandbox.com or https://connect.squareup.com */
  baseUrl: string;
}

const BASE_URLS: Record<SquareEnvironment, string> = {
  sandbox: "https://connect.squareupsandbox.com",
  production: "https://connect.squareup.com",
};

function read(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** The reason Square cannot be connected here, or null when it can. */
export function squareConfigProblem(): string | null {
  const environment = read("SQUARE_ENVIRONMENT") ?? "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    return "SQUARE_ENVIRONMENT must be sandbox or production.";
  }
  const applicationId = read("SQUARE_APPLICATION_ID");
  if (!applicationId) return "SQUARE_APPLICATION_ID is not set.";
  if (!read("SQUARE_APPLICATION_SECRET")) return "SQUARE_APPLICATION_SECRET is not set.";
  const sandboxId = applicationId.startsWith("sandbox-");
  if (environment === "sandbox" && !sandboxId) {
    return "SQUARE_APPLICATION_ID is not a sandbox application id.";
  }
  if (environment === "production" && sandboxId) {
    return "SQUARE_APPLICATION_ID is a sandbox application id.";
  }
  // Tokens are stored sealed; without the key there is nowhere safe to keep them.
  if (!read("INTEGRATION_CREDENTIAL_KEY")) return "INTEGRATION_CREDENTIAL_KEY is not set.";
  return null;
}

export function squareConfig(): SquareConfig | null {
  if (squareConfigProblem()) return null;
  const environment = (read("SQUARE_ENVIRONMENT") ?? "sandbox") as SquareEnvironment;
  return {
    environment,
    applicationId: read("SQUARE_APPLICATION_ID") as string,
    applicationSecret: read("SQUARE_APPLICATION_SECRET") as string,
    webhookSignatureKey: read("SQUARE_WEBHOOK_SIGNATURE_KEY"),
    baseUrl: BASE_URLS[environment],
  };
}
