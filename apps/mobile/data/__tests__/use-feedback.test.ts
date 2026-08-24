/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFeedback } from "../use-feedback";
import * as api from "../api";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public requestId?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

function makeResponse(
  ids: string[],
  hasMore = false,
  nextCursor: string | null = null,
) {
  return {
    data: ids.map((id) => ({
      responseId: id,
      locationId: "loc-1",
      rating: 4,
      note: null,
      submittedAt: "2026-01-01T00:00:00Z",
      isRead: true,
      isResolved: false,
    })),
    meta: { hasMore, nextCursor },
    requestId: "req-1",
  };
}

const mockApiFetch = api.apiFetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFeedback", () => {
  it("clears items immediately when orgId changes", async () => {
    mockApiFetch.mockResolvedValue(makeResponse(["fb-1", "fb-2"]));

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | undefined }) => useFeedback(orgId),
      { initialProps: { orgId: "org-a" } },
    );

    await act(() => result.current.load());
    expect(result.current.items).toHaveLength(2);

    rerender({ orgId: "org-b" });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it("discards a stale response after org switch", async () => {
    let resolveOrgA: (v: unknown) => void;
    const orgAPromise = new Promise((r) => {
      resolveOrgA = r;
    });

    mockApiFetch.mockImplementation((_path: string, orgId: string) => {
      if (orgId === "org-a") return orgAPromise;
      return Promise.resolve(makeResponse(["fb-new"]));
    });

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | undefined }) => useFeedback(orgId),
      { initialProps: { orgId: "org-a" } },
    );

    // Start loading org-a (will hang on the promise).
    let orgALoadPromise: Promise<void>;
    act(() => {
      orgALoadPromise = result.current.load();
    });

    // Switch to org-b before org-a resolves.
    rerender({ orgId: "org-b" });
    await act(() => result.current.load());

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].orgId).toBe("org-b");

    // Now let org-a resolve — it must NOT overwrite org-b's data.
    await act(async () => {
      resolveOrgA!(makeResponse(["fb-stale-1", "fb-stale-2", "fb-stale-3"]));
      await orgALoadPromise!;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].orgId).toBe("org-b");
  });

  it("does not set error from a stale request", async () => {
    let rejectOrgA: (e: Error) => void;
    const orgAPromise = new Promise((_r, rej) => {
      rejectOrgA = rej;
    });

    mockApiFetch.mockImplementation((_path: string, orgId: string) => {
      if (orgId === "org-a") return orgAPromise;
      return Promise.resolve(makeResponse(["fb-1"]));
    });

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | undefined }) => useFeedback(orgId),
      { initialProps: { orgId: "org-a" } },
    );

    let orgALoadPromise: Promise<void>;
    act(() => {
      orgALoadPromise = result.current.load();
    });

    rerender({ orgId: "org-b" });
    await act(() => result.current.load());

    // Reject the stale org-a request.
    await act(async () => {
      rejectOrgA!(new api.ApiError("org-a failed", 500));
      try {
        await orgALoadPromise!;
      } catch {}
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });

  it("resets loading flags on org switch", async () => {
    mockApiFetch.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | undefined }) => useFeedback(orgId),
      { initialProps: { orgId: "org-a" } },
    );

    act(() => {
      result.current.load();
    });

    expect(result.current.loading).toBe(true);

    rerender({ orgId: "org-b" });

    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.loadingMore).toBe(false);
  });

  it("latest-request-wins: second load() supersedes first", async () => {
    let resolveFirst: (v: unknown) => void;
    const firstPromise = new Promise((r) => {
      resolveFirst = r;
    });
    let resolveSecond: (v: unknown) => void;
    const secondPromise = new Promise((r) => {
      resolveSecond = r;
    });

    let callCount = 0;
    mockApiFetch.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? firstPromise : secondPromise;
    });

    const { result } = renderHook(() => useFeedback("org-a"));

    // Fire two load() calls without awaiting the first.
    let p1: Promise<void>;
    let p2: Promise<void>;
    act(() => {
      p1 = result.current.load();
    });
    act(() => {
      p2 = result.current.load();
    });

    // Resolve the second first.
    await act(async () => {
      resolveSecond!(makeResponse(["fb-second"]));
      await p2!;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("fb-second");

    // Now resolve the first — it must be discarded (latest-request-wins).
    await act(async () => {
      resolveFirst!(makeResponse(["fb-first-stale", "fb-first-stale-2"]));
      await p1!;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("fb-second");
  });

  it("prevents duplicate concurrent loadMore calls", async () => {
    mockApiFetch.mockResolvedValueOnce(
      makeResponse(["fb-1"], true, "cursor-1"),
    );

    const { result } = renderHook(() => useFeedback("org-a"));
    await act(() => result.current.load());

    expect(result.current.hasMore).toBe(true);

    // Make loadMore hang so we can test concurrency guard.
    let resolveMore: (v: unknown) => void;
    mockApiFetch.mockImplementation(
      () => new Promise((r) => { resolveMore = r; }),
    );

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.loadingMore).toBe(true);

    // Second call while first is in-flight — should be a no-op.
    act(() => {
      result.current.loadMore();
    });

    // Only one additional apiFetch call should have been made (the first loadMore).
    // load() was 1 call, first loadMore is 2nd call. No 3rd call.
    expect(mockApiFetch).toHaveBeenCalledTimes(2);

    // Resolve to clean up.
    await act(async () => {
      resolveMore!(makeResponse(["fb-2"]));
    });

    expect(result.current.loadingMore).toBe(false);
  });

  it("stale same-org error does not overwrite state after refresh starts", async () => {
    let rejectLoad: (e: Error) => void;
    const loadPromise = new Promise((_r, rej) => {
      rejectLoad = rej;
    });

    let callCount = 0;
    mockApiFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return loadPromise;
      return Promise.resolve(makeResponse(["fb-refreshed"]));
    });

    const { result } = renderHook(() => useFeedback("org-a"));

    // Start load (will hang).
    let loadP: Promise<void>;
    act(() => {
      loadP = result.current.load();
    });

    // Start refresh before load finishes — supersedes load.
    await act(() => result.current.refresh());

    expect(result.current.items).toHaveLength(1);
    expect(result.current.error).toBeNull();

    // Now reject the stale load — error must NOT appear.
    await act(async () => {
      rejectLoad!(new api.ApiError("stale load failed", 500));
      try {
        await loadP!;
      } catch {}
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });

  it("stale load does not clear loading flag while newer load is in flight", async () => {
    let resolveFirst: (v: unknown) => void;
    const firstPromise = new Promise((r) => {
      resolveFirst = r;
    });

    let callCount = 0;
    mockApiFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return firstPromise;
      return new Promise(() => {}); // second load never resolves
    });

    const { result } = renderHook(() => useFeedback("org-a"));

    // Start first load.
    let p1: Promise<void>;
    act(() => {
      p1 = result.current.load();
    });
    expect(result.current.loading).toBe(true);

    // Start second load — supersedes first, loading stays true.
    act(() => {
      result.current.load();
    });
    expect(result.current.loading).toBe(true);

    // Resolve the first — its finally must NOT clear loading.
    await act(async () => {
      resolveFirst!(makeResponse(["fb-stale"]));
      await p1!;
    });

    expect(result.current.loading).toBe(true);
  });

  it("stale loadMore does not append after a newer refresh", async () => {
    // Initial load with hasMore.
    mockApiFetch.mockResolvedValueOnce(
      makeResponse(["fb-1"], true, "cursor-1"),
    );

    const { result } = renderHook(() => useFeedback("org-a"));
    await act(() => result.current.load());
    expect(result.current.items).toHaveLength(1);

    // Start loadMore (will hang).
    let resolveMore: (v: unknown) => void;
    let moreCallCount = 0;
    mockApiFetch.mockImplementation(() => {
      moreCallCount++;
      if (moreCallCount === 1) {
        return new Promise((r) => {
          resolveMore = r;
        });
      }
      return Promise.resolve(makeResponse(["fb-refreshed"]));
    });

    let moreP: Promise<void>;
    act(() => {
      moreP = result.current.loadMore();
    });

    // Refresh supersedes the in-flight loadMore.
    await act(() => result.current.refresh());
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("fb-refreshed");

    // Resolve the stale loadMore — must NOT append.
    await act(async () => {
      resolveMore!(makeResponse(["fb-stale-page2"]));
      await moreP!;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("fb-refreshed");
  });

  it("never returns items belonging to wrong orgId", async () => {
    // Simulate a scenario where items state briefly contains wrong-org data
    // by resolving org-a data just as we switch to org-b. The useMemo filter
    // ensures the returned items never include wrong-org entries.
    let resolveOrgA: (v: unknown) => void;
    const orgAPromise = new Promise((r) => {
      resolveOrgA = r;
    });

    mockApiFetch.mockImplementation((_path: string, orgId: string) => {
      if (orgId === "org-a") return orgAPromise;
      return Promise.resolve(makeResponse(["fb-b1"]));
    });

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | undefined }) => useFeedback(orgId),
      { initialProps: { orgId: "org-a" } },
    );

    act(() => {
      result.current.load();
    });

    // Switch org before org-a resolves.
    rerender({ orgId: "org-b" });
    await act(() => result.current.load());

    // At every point after the switch, items must belong to org-b only.
    for (const item of result.current.items) {
      expect(item.orgId).toBe("org-b");
    }

    // Resolve org-a — should still not leak into results.
    await act(async () => {
      resolveOrgA!(makeResponse(["fb-a1", "fb-a2"]));
    });

    for (const item of result.current.items) {
      expect(item.orgId).toBe("org-b");
    }
    expect(result.current.items).toHaveLength(1);
  });
});
