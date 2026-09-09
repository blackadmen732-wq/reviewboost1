import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readSupabasePublicEnv, requireSupabasePublicEnv } from "@/lib/supabase/public-env";
import { isPreviewDeployment, validateServerConfig } from "@/lib/server/env";

describe("preview and public Supabase env", () => {
  const keys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CUSTOMER_NOTE_ENCRYPTION_KEY",
    "PUBLIC_FRONTEND_URL",
    "VERCEL_ENV",
  ] as const;
  const previous: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  function snapshot() {
    for (const key of keys) previous[key] = process.env[key];
  }

  it("reports missing publishable env instead of inventing empty strings", () => {
    snapshot();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(readSupabasePublicEnv()).toEqual({ ok: false });
    expect(() => requireSupabasePublicEnv()).toThrow(/not configured/);
  });

  it("treats VERCEL_ENV=preview as a preview deployment", () => {
    snapshot();
    process.env.VERCEL_ENV = "preview";
    expect(isPreviewDeployment()).toBe(true);
  });

  it("fails closed when preview-required env is missing", () => {
    snapshot();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CUSTOMER_NOTE_ENCRYPTION_KEY;
    process.env.VERCEL_ENV = "preview";
    process.env.PUBLIC_FRONTEND_URL = "https://preview.example.com";

    const result = validateServerConfig();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((p) => p.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
    expect(result.problems.some((p) => p.includes("SUPABASE_URL"))).toBe(true);
  });
});
