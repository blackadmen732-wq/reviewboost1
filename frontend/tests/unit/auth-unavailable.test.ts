import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServerClient = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...args),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

import { currentUser } from "@/lib/supabase/server";

/**
 * `currentUser()` documents itself as "Never throws — callers decide what to
 * do", and two pages take it at its word.
 *
 * It did throw. `createServerClient` throws outright when the Supabase URL or
 * key is missing, so an environment without them crashed `/login` — the page an
 * unauthenticated visitor is redirected *to*, which made the way back into the
 * product a 500.
 *
 * Any failure to establish who the viewer is means "nobody": null, fail-closed.
 */
describe("currentUser cannot crash a page", () => {
  const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // The real library's contract, reproduced: empty credentials throw.
    createServerClient.mockImplementation((url: unknown, key: unknown) => {
      if (!url || !key) {
        throw new Error("Your project's URL and Key are required to create a Supabase client!");
      }
      return { auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } };
    });
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.clearAllMocks();
  });

  it("returns null instead of throwing when Supabase is unconfigured", async () => {
    await expect(currentUser()).resolves.toBeNull();
  });

  it("returns null when the auth service is unreachable", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    createServerClient.mockReturnValue({
      auth: {
        getUser: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
      },
    });

    await expect(currentUser()).resolves.toBeNull();
  });

  it("still returns the user when everything is working", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    await expect(currentUser()).resolves.toEqual({ id: "user-1" });
  });
});
