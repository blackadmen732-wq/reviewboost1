import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const exchange = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));
vi.mock("@/lib/server/apple-sign-in", () => ({
  appleServicesId: () => null,
  keepAppleRefreshToken: vi.fn(),
}));

/**
 * Where Google, Apple and the sign-in email's link come back.
 *
 * The session cookie is set for the host the browser used. Next builds
 * `request.url` from its own bind address (`localhost`) under `next dev` and
 * `next start`, so redirecting there dropped the cookie and put the person on
 * sign-in again with a valid session. Redirects use PUBLIC_FRONTEND_URL.
 */
describe("/auth/callback", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_FRONTEND_URL", "https://reviewboost.example");
    exchange.mockReset();
  });

  async function callback(query: string) {
    const { GET } = await import("@/app/auth/callback/route");
    // The URL Next hands the route, from its bind address, not the browser's.
    const response = await GET(new NextRequest(`http://localhost:3000/auth/callback?${query}`));
    return new URL(response.headers.get("location")!);
  }

  it("signs in and lands on the page the person was going to, on the app's own origin", async () => {
    exchange.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    const to = await callback("code=abc&next=%2Ffeedback&provider=email");
    expect(exchange).toHaveBeenCalledWith("abc");
    expect(to.origin).toBe("https://reviewboost.example");
    expect(to.pathname).toBe("/feedback");
  });

  it("sends a code that cannot be exchanged back to sign-in, on the same origin", async () => {
    exchange.mockResolvedValue({ data: { session: null }, error: { status: 400 } });
    const to = await callback("code=from-another-phone&next=%2Fhome&provider=email");
    expect(to.origin).toBe("https://reviewboost.example");
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("sign_in_failed");
    expect(to.searchParams.get("next")).toBe("/home");
  });

  it("never follows a `next` that leaves the app", async () => {
    exchange.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    const to = await callback("code=abc&next=https%3A%2F%2Fevil.example%2Fsteal");
    expect(to.origin).toBe("https://reviewboost.example");
  });
});
