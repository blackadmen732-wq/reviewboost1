import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn(async (_args: unknown) => ({ error: null as null | { message: string } }));
vi.mock("../supabase", () => ({ supabase: { auth: { verifyOtp: (a: unknown) => verifyOtp(a) } } }));

import { signInForReview } from "../review-sign-in";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://reviewboost.fit/";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  verifyOtp.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("signInForReview", () => {
  it("exchanges the server's one-time token for a session", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { tokenHash: "h1" } }), { status: 200 }));
    expect(await signInForReview("app-review@reviewboost.fit", "482913")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://reviewboost.fit/api/v1/public/review-sign-in",
      expect.objectContaining({ method: "POST" }),
    );
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "h1", type: "magiclink" });
  });

  it("is a quiet no when the server refuses, is off, or cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    expect(await signInForReview("a@b.c", "000000")).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await signInForReview("a@b.c", "000000")).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await signInForReview("a@b.c", "000000")).toBe(false);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does nothing without an API origin", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    expect(await signInForReview("a@b.c", "123456")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
