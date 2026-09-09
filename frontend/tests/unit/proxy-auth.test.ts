import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import {
  decideProxyAccess,
  isOwnerPath,
  OWNER_PREFIXES,
} from "@/lib/supabase/proxy-guard";
import { readSupabasePublicEnv, requireSupabasePublicEnv, SupabaseEnvError } from "@/lib/supabase/public-env";

const getUser = vi.fn();
const createServerClient = vi.fn((url: string, key: string, options?: unknown) => {
  void url;
  void key;
  void options;
  return { auth: { getUser } };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, options?: unknown) =>
    createServerClient(url, key, options),
}));

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("isOwnerPath", () => {
  it("matches every owner prefix and nested path", () => {
    for (const prefix of OWNER_PREFIXES) {
      expect(isOwnerPath(prefix)).toBe(true);
      expect(isOwnerPath(`${prefix}/nested`)).toBe(true);
    }
  });

  it("does not treat public pages as owner routes", () => {
    expect(isOwnerPath("/")).toBe(false);
    expect(isOwnerPath("/login")).toBe(false);
    expect(isOwnerPath("/q/token")).toBe(false);
    expect(isOwnerPath("/homeless")).toBe(false);
  });
});

describe("decideProxyAccess", () => {
  it("denies owner routes when Supabase env is missing", () => {
    expect(
      decideProxyAccess({ pathname: "/home", hasSupabaseEnv: false, user: null }),
    ).toEqual({ action: "unavailable" });
    expect(
      decideProxyAccess({
        pathname: "/settings/team",
        hasSupabaseEnv: false,
        user: { id: "u1" },
      }),
    ).toEqual({ action: "unavailable" });
  });

  it("allows public routes when Supabase env is missing", () => {
    expect(
      decideProxyAccess({ pathname: "/", hasSupabaseEnv: false, user: null }),
    ).toEqual({ action: "allow" });
    expect(
      decideProxyAccess({ pathname: "/login", hasSupabaseEnv: false, user: null }),
    ).toEqual({ action: "allow" });
  });

  it("denies unauthenticated owner routes when env is present", () => {
    expect(
      decideProxyAccess({ pathname: "/home", hasSupabaseEnv: true, user: null }),
    ).toEqual({ action: "redirect-login", next: "/home" });
  });

  it("allows authenticated owner routes when env is present", () => {
    expect(
      decideProxyAccess({
        pathname: "/home",
        hasSupabaseEnv: true,
        user: { id: "user-1" },
      }),
    ).toEqual({ action: "allow" });
  });
});

describe("readSupabasePublicEnv", () => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("returns null when either value is missing or blank", () => {
    expect(readSupabasePublicEnv()).toBeNull();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    expect(readSupabasePublicEnv()).toBeNull();
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "   ";
    expect(readSupabasePublicEnv()).toBeNull();
  });

  it("returns trimmed values when both are set", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = " https://example.supabase.co ";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = " anon-key ";
    expect(readSupabasePublicEnv()).toEqual({
      url: "https://example.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("throws rather than handing empty strings to a client constructor", () => {
    expect(() => requireSupabasePublicEnv()).toThrow(SupabaseEnvError);
  });
});

describe("proxy()", () => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    createServerClient.mockClear();
    getUser.mockReset();
    for (const key of keys) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
    // jsdom's Headers is not the same class NextResponse.next() checks for.
    vi.spyOn(NextResponse, "next").mockImplementation(
      () => new NextResponse(null, { status: 200 }),
    );
    vi.spyOn(NextResponse, "redirect").mockImplementation(
      (url) =>
        new NextResponse(null, {
          status: 307,
          headers: { location: String(url) },
        }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  async function loadProxy() {
    return import("../../proxy");
  }

  it("returns 503 for a protected route when env is missing and never creates a client", async () => {
    const { proxy } = await loadProxy();
    const response = await proxy(request("/home"));
    expect(response.status).toBe(503);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("lets a public route through when env is missing without creating a client", async () => {
    const { proxy } = await loadProxy();
    const response = await proxy(request("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated owner request to login", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    getUser.mockResolvedValue({ data: { user: null } });

    const { proxy } = await loadProxy();
    const response = await proxy(request("/stands"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/stands");
    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.any(Object),
    );
    expect(createServerClient.mock.calls[0]?.[0]).not.toBe("");
    expect(createServerClient.mock.calls[0]?.[1]).not.toBe("");
  });

  it("allows an authenticated owner request through", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const { proxy } = await loadProxy();
    const response = await proxy(request("/home"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClient).toHaveBeenCalledTimes(1);
  });
});
