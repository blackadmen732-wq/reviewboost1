import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createServerClient = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...args),
}));

import { NextRequest } from "next/server";

import { isOwnerPath, proxy } from "@/proxy";
import { DESKTOP_NAV, MOBILE_NAV } from "@/features/dashboard/nav-items";

/**
 * A public page must never depend on the auth service.
 *
 * The proxy built its Supabase client at the top of the function, for every
 * matched request. `createServerClient` throws when the URL or key is missing,
 * so a deployment without those values answered `500` at `/` — the public
 * homepage, which needs no session at all — while the build and every status
 * check stayed green. The crash happened before `app/page.tsx` ran, so the
 * root page's own try/catch fallback to <PublicHome /> never got a chance.
 */

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function withEnv(configured: boolean) {
  if (configured) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  } else {
    for (const key of ENV_KEYS) delete process.env[key];
  }
}

/**
 * A client that answers with a verified user, or with none.
 *
 * This deliberately reproduces the real `createServerClient` contract: given an
 * empty URL or key it *throws*, which is the exact behaviour that turned a
 * missing environment variable into a 500 on the public homepage. A mock that
 * quietly returned a client here would let the original bug pass.
 */
function clientReturning(user: unknown) {
  createServerClient.mockImplementation((url: unknown, key: unknown) => {
    if (!url || !key) {
      throw new Error("Your project's URL and Key are required to create a Supabase client!");
    }
    return { auth: { getUser: async () => ({ data: { user } }) } };
  });
}

/**
 * vitest's jsdom environment installs its own `Headers`, while `NextRequest` is
 * built on Node's. `NextResponse.next({ request })` checks
 * `request.headers instanceof Headers` against the global, so the two classes
 * have to be the same one here. In production both are Node's and this does not
 * arise — it is purely an artifact of running server code under jsdom.
 */
beforeAll(() => {
  globalThis.Headers = new NextRequest(new URL("https://reviewboost.fit/"))
    .headers.constructor as typeof Headers;
});

function request(pathname: string) {
  return new NextRequest(new URL(pathname, "https://reviewboost.fit"));
}

function isRedirectToLogin(response: Response) {
  const location = response.headers.get("location");
  return Boolean(location && new URL(location).pathname === "/login");
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  clientReturning(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.clearAllMocks();
});

describe("public routes survive an unusable auth client", () => {
  const PUBLIC = ["/", "/privacy", "/terms", "/pricing", "/product", "/security", "/how-it-works", "/integrity", "/support", "/login", "/offline"];

  it("serves every public route when Supabase is not configured at all", async () => {
    withEnv(false);

    for (const pathname of PUBLIC) {
      // The regression: this used to throw, which Next renders as a 500.
      const response = await proxy(request(pathname));
      expect(response.status, `${pathname} should render`).toBe(200);
      expect(isRedirectToLogin(response), `${pathname} should not bounce`).toBe(false);
    }
  });

  it("never even builds an auth client for a public route", async () => {
    withEnv(true);

    for (const pathname of PUBLIC) {
      await proxy(request(pathname));
    }

    // Not merely "did not throw": the round-trip is not paid for at all.
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("serves the homepage even when the auth service itself is down", async () => {
    withEnv(true);
    createServerClient.mockImplementation(() => {
      throw new Error("getaddrinfo ENOTFOUND");
    });

    const response = await proxy(request("/"));
    expect(response.status).toBe(200);
  });
});

describe("owner routes still fail closed", () => {
  it("redirects to login rather than crashing when Supabase is unconfigured", async () => {
    withEnv(false);

    const response = await proxy(request("/home"));
    // Not a 500, and not a pass-through either.
    expect(isRedirectToLogin(response)).toBe(true);
  });

  it("redirects to login when the auth client throws", async () => {
    withEnv(true);
    createServerClient.mockImplementation(() => {
      throw new Error("unreachable");
    });

    expect(isRedirectToLogin(await proxy(request("/home")))).toBe(true);
  });

  it("redirects to login when getUser rejects", async () => {
    withEnv(true);
    createServerClient.mockReturnValue({
      auth: {
        getUser: async () => {
          throw new Error("network");
        },
      },
    });

    expect(isRedirectToLogin(await proxy(request("/settings/billing")))).toBe(true);
  });

  it("carries where they were going", async () => {
    withEnv(true);
    clientReturning(null);

    const response = await proxy(request("/feedback/abc"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("next")).toBe("/feedback/abc");
  });

  it("lets a verified owner through", async () => {
    withEnv(true);
    clientReturning({ id: "user-1" });

    const response = await proxy(request("/home"));
    expect(isRedirectToLogin(response)).toBe(false);
    expect(response.status).toBe(200);
  });
});

/**
 * The prefix list had drifted from the app: `/text-requests` and
 * `/customer-page` are two of the four destinations in the nav bar, and neither
 * was protected — so an owner sitting on them never had their token refreshed,
 * which is the dead-session-after-a-shift problem this file exists to prevent.
 */
describe("the protected list matches the real app", () => {
  it("protects every destination in the nav", () => {
    for (const item of [...MOBILE_NAV, ...DESKTOP_NAV]) {
      expect(isOwnerPath(item.href), `${item.href} is in the nav but unprotected`).toBe(true);
    }
  });

  it("protects the owner pages that are not in the nav", () => {
    for (const pathname of ["/customer-page", "/select-org", "/onboarding", "/settings/billing", "/settings/delete", "/stands/abc", "/praise", "/reviews", "/customers"]) {
      expect(isOwnerPath(pathname), `${pathname} should be protected`).toBe(true);
    }
  });

  it("leaves the public site and the customer flow alone", () => {
    // /goodbye is where a deletion lands. It must render without an auth
    // round-trip: the login it would have used has just been removed, so
    // classifying it as owner-only would redirect straight back to /login.
    for (const pathname of ["/", "/pricing", "/privacy", "/terms", "/login", "/support", "/goodbye", "/delete-account", "/q/abc123"]) {
      expect(isOwnerPath(pathname), `${pathname} should be public`).toBe(false);
    }
  });

  it("does not protect a path that merely starts with an owner prefix", () => {
    expect(isOwnerPath("/homepage")).toBe(false);
    expect(isOwnerPath("/settings-export")).toBe(false);
  });
});

it("keeps a chosen plan and feedback filters when an expired session returns to sign-in", async () => {
  withEnv(true); clientReturning(null);
  for (const path of ["/settings/billing?plan=growth", "/feedback?show=all&rating=2"]) {
    const response = await proxy(request(path));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("next")).toBe(path);
  }
});
