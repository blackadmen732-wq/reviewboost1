import type { CustomerFlowApi } from "@/lib/api/customer-flow-api";
import { CustomerApiError } from "@/lib/api/customer-api-error";
type FixtureOperation = "context" | "rating";

declare global {
  interface Window {
    __RB_FIXTURE_CALLS__?: Array<{
      operation: FixtureOperation;
      idempotencyKey?: string;
      body?: unknown;
    }>;
  }
}

const idempotentResults = new Map<string, unknown>();
const transientFailures = new Set<string>();

function logCall(operation: FixtureOperation, idempotencyKey?: string, body?: unknown) {
  if (typeof window === "undefined") return;
  window.__RB_FIXTURE_CALLS__ ??= [];
  window.__RB_FIXTURE_CALLS__.push({
    operation,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(body === undefined ? {} : { body }),
  });
}

function assertOnline() {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new CustomerApiError({
      status: 0,
      code: "network_error",
      message: "Development fixture is offline.",
    });
  }
}

async function delay(token: string) {
  const milliseconds = token === "fixture-slow" ? 1_350 : 110;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function unavailable(): never {
  throw new CustomerApiError({
    status: 404,
    code: "review_link_inactive",
    message: "This review link is not active.",
    requestId: "fixture-request",
  });
}

function transientFailure(operation: FixtureOperation, token: string, idempotencyKey: string) {
  const failureKey = `${operation}:${token}:${idempotencyKey}`;
  if (!transientFailures.has(failureKey)) {
    transientFailures.add(failureKey);
    throw new CustomerApiError({
      status: 503,
      code: "temporarily_unavailable",
      message: "Development fixture transient failure.",
      requestId: "fixture-request",
    });
  }
}

function stableResult<T>(operation: FixtureOperation, key: string, create: () => T): T {
  const mapKey = `${operation}:${key}`;
  if (idempotentResults.has(mapKey)) {
    return idempotentResults.get(mapKey) as T;
  }
  const value = create();
  idempotentResults.set(mapKey, value);
  return value;
}

export const developmentCustomerFlowApi: CustomerFlowApi = {
  async getContext(token) {
    logCall("context");
    assertOnline();
    await delay(token);

    if (token === "fixture-inactive" || token === "fixture-unknown") unavailable();
    if (token === "fixture-api-error") {
      throw new CustomerApiError({
        status: 503,
        code: "temporarily_unavailable",
        message: "Development fixture failed to load.",
        requestId: "fixture-request",
      });
    }

    return {
      business: { name: "Mario’s Pizza", logoUrl: null },
      location: { name: "Downtown" },
      page:
        token === "fixture-no-page"
          ? null
          : {
              templateId: "classic",
              tagline: "Thanks for stopping by — it takes one tap.",
              logoUrl: null,
              heroUrl: null,
            },
      destination: {
        provider: "google",
        url: "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
      },
      googleReviewUrl:
        "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
      supportedLocales: ["en", "es", "ht"],
      defaultLocale: "en",
      presentation: {
        heroUrl: null,
        transform: { x: 0, y: 0, scale: 1 },
        tagline: null,
      },
    };
  },

  // Logged before the first await, as the production client starts its
  // request before it returns: a test can see the save began before the page
  // left. The fixture tokens that once failed one step now fail the whole tap
  // once, then succeed on the re-send with the same key.
  async submitRating(token, body, options) {
    logCall("rating", options.idempotencyKey, body);
    assertOnline();
    await delay(token);
    if (
      token === "fixture-session-error" ||
      token === "fixture-response-error" ||
      token === "fixture-destination-error"
    ) {
      transientFailure("rating", token, options.idempotencyKey);
    }
    stableResult("rating", options.idempotencyKey, () => true);
  },

};

