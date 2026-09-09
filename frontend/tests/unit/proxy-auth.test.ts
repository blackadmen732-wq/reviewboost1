import { afterEach, describe, expect, it } from "vitest";

import { isOwnerPath, OWNER_PREFIXES } from "@/lib/security/owner-paths";
import {
  loginRedirectFor,
  mustRedirectOwnerToLogin,
  unverifiedWhenEnvMissing,
} from "@/lib/security/proxy-gate";

describe("proxy — fail-closed authentication", () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  });

  it("treats missing Supabase env as an unverified session, not an auth skip", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(unverifiedWhenEnvMissing()).toBe(true);

    for (const path of OWNER_PREFIXES) {
      expect(mustRedirectOwnerToLogin(path, null), path).toBe(true);
      expect(loginRedirectFor(path)).toEqual({ pathname: "/login", next: path });
    }
  });

  it("does not redirect the public homepage when env is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(isOwnerPath("/")).toBe(false);
    expect(mustRedirectOwnerToLogin("/", null)).toBe(false);
  });

  it("denies owner pages without a verified session when env is present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    expect(unverifiedWhenEnvMissing()).toBe(false);
    expect(mustRedirectOwnerToLogin("/home", null)).toBe(true);
    expect(mustRedirectOwnerToLogin("/settings/google", null)).toBe(true);
  });

  it("lets a verified session through to owner pages", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    expect(mustRedirectOwnerToLogin("/home", { id: "user-1" })).toBe(false);
  });
});
