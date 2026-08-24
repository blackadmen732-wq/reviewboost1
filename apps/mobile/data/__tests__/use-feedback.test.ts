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
});
