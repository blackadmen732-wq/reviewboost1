import type { CustomerFlowApi } from "@/lib/api/customer-flow-api";
import { CustomerApiError } from "@/lib/api/customer-api-error";
import type {
  CreateSessionResponse,
  CustomerReviewContext,
  SubmitResponseResponse,
  TeamPraiseResponse,
} from "@/lib/api/customer-flow-types";
import { isLookId, type CustomerPageDesign } from "@/lib/customer-page/design";

type FixtureOperation = "context" | "session" | "response" | "google-click" | "team-praise";

declare global {
  interface Window {
    __RB_FIXTURE_CALLS__?: Array<{ operation: FixtureOperation; idempotencyKey?: string }>;
  }
}

const idempotentResults = new Map<string, unknown>();
const transientFailures = new Set<string>();

function logCall(operation: FixtureOperation, idempotencyKey?: string) {
  if (typeof window === "undefined") return;
  window.__RB_FIXTURE_CALLS__ ??= [];
  window.__RB_FIXTURE_CALLS__.push({
    operation,
    ...(idempotencyKey ? { idempotencyKey } : {}),
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

function shortId(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").slice(-16) || "fixture";
}

/*
 * The design the backend does not send yet.
 *
 * Development only — the module is dynamically imported behind a non-production
 * check, which is why none of this reaches a production bundle. Tokens select the
 * states worth looking at: no photograph, a photograph that fails to load, each
 * Look, and a name too long to be a wordmark.
 */
const fixtureDesign: CustomerPageDesign = {
  heroImage: "/fixtures/customer-page-hero.jpg",
  heroFocalX: 50,
  heroFocalY: 74,
  heroZoom: 1.06,
  logo: null,
  look: "signature",
  tagline: "Good pizza. Brighter days.",
};

function fixtureContext(token: string): CustomerReviewContext & { design: CustomerPageDesign } {
  const look = token.startsWith("fixture-look-")
    ? token.slice("fixture-look-".length)
    : null;

  const design: CustomerPageDesign = {
    ...fixtureDesign,
    ...(token === "fixture-no-photo" ? { heroImage: null } : {}),
    ...(token === "fixture-broken-photo"
      ? { heroImage: "/fixtures/does-not-exist.jpg" }
      : {}),
    ...(isLookId(look) ? { look } : {}),
  };

  return {
    business: {
      name:
        token === "fixture-long-name"
          ? "Southeast Regional Dental Associates"
          : "Mario’s Pizza",
      logoUrl: null,
    },
    location: { name: "Downtown" },
    googleReviewUrl:
      "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    supportedLocales: token === "fixture-one-language" ? ["en"] : ["en", "es", "ht"],
    defaultLocale: "en",
    design,
  };
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

    return fixtureContext(token);
  },

  async createSession(token, _body, options) {
    logCall("session", options.idempotencyKey);
    assertOnline();
    await delay(token);
    if (token === "fixture-session-error") {
      transientFailure("session", token, options.idempotencyKey);
    }
    return stableResult<CreateSessionResponse>("session", options.idempotencyKey, () => ({
      sessionId: `session_${shortId(options.idempotencyKey)}`,
    }));
  },

  async submitResponse(token, _body, options) {
    logCall("response", options.idempotencyKey);
    assertOnline();
    await delay(token);
    if (token === "fixture-response-error") {
      transientFailure("response", token, options.idempotencyKey);
    }
    return stableResult<SubmitResponseResponse>("response", options.idempotencyKey, () => ({
      responseId: `response_${shortId(options.idempotencyKey)}`,
    }));
  },

  async recordGoogleClick(token, _body, options) {
    logCall("google-click", options.idempotencyKey);
    assertOnline();
    if (token === "fixture-google-error") {
      transientFailure("google-click", token, options.idempotencyKey);
    }
    stableResult("google-click", options.idempotencyKey, () => true);
  },

  async submitTeamPraise(token, _body, options) {
    logCall("team-praise", options.idempotencyKey);
    assertOnline();
    await delay(token);
    if (token === "fixture-praise-error") {
      transientFailure("team-praise", token, options.idempotencyKey);
    }
    return stableResult<TeamPraiseResponse>("team-praise", options.idempotencyKey, () => ({
      teamPraiseId: `praise_${shortId(options.idempotencyKey)}`,
    }));
  },
};

