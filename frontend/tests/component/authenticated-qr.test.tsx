import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const getSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession } }),
}));
vi.mock("@/components/ui/toast", () => ({ notify: { error: vi.fn() } }));
import { useAuthenticatedQr } from "@/lib/hooks/use-authenticated-qr";
beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({
    data: { session: { access_token: "owner-token" } },
  });
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:authenticated-qr"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("loads the chosen business's QR with explicit scope, Bearer auth and cookies omitted", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const view = renderHook(() => useAuthenticatedQr("stand-id", "business-id"));
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  const options = fetcher.mock.calls[0]![1] as RequestInit;
  const headers = new Headers(options.headers);
  expect(headers.get("authorization")).toBe("Bearer owner-token");
  expect(headers.get("x-organization-id")).toBe("business-id");
  expect(options.credentials).toBe("omit");
  expect(view.result.current.objectUrl).toBe("blob:authenticated-qr");
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:authenticated-qr");
});
it("recovers the QR loading state if session lookup rejects", async () => {
  getSession.mockRejectedValueOnce(new Error("Offline"));
  const view = renderHook(() => useAuthenticatedQr("stand-id", "business-id"));
  await waitFor(() => expect(view.result.current.status).toBe("error"));
});
it("marks a missing session expired without fetching a code", async () => {
  getSession.mockResolvedValueOnce({ data: { session: null } });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const view = renderHook(() => useAuthenticatedQr("stand-id", "business-id"));
  await waitFor(() => expect(view.result.current.status).toBe("expired"));
  expect(fetcher).not.toHaveBeenCalled();
});
