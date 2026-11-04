import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * Deleting your own account must work with no business selected (launch gap
 * L1), so `accountFetch` sends the session and nothing that names a business,
 * while `apiFetch` keeps requiring one.
 */

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: "tok" } }, error: null }),
    },
  },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.example.test");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

it("sends the session but no business id", async () => {
  reply(200, { data: { deleted: true } });
  const { accountFetch } = await import("../api");
  await accountFetch("/api/v1/account/personal-deletion", {
    method: "POST",
    body: "{}",
  });
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("https://api.example.test/api/v1/account/personal-deletion");
  const headers = (init as RequestInit).headers as Record<string, string>;
  expect(headers.Authorization).toBe("Bearer tok");
  expect(headers).not.toHaveProperty("X-Organization-Id");
});

it("carries the API's error code so the screen can name the business", async () => {
  reply(409, {
    error: { code: "owns_business", message: "You're the only owner of Solo Salon." },
  });
  const { accountFetch, ApiError } = await import("../api");
  const failure = await accountFetch("/x", { method: "POST" }).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as InstanceType<typeof ApiError>).code).toBe("owns_business");
  expect((failure as Error).message).toContain("Solo Salon");
});

it("business calls still refuse to go out without a business", async () => {
  const { apiFetch } = await import("../api");
  await expect(apiFetch("/x", "")).rejects.toThrow(/No organization selected/);
  expect(fetchMock).not.toHaveBeenCalled();
});
