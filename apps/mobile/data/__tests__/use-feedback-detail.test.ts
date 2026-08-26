/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFeedbackDetail } from "../use-feedback-detail";
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

function makeResponse(id: string) {
  return {
    data: {
      responseId: id,
      locationId: "loc-1",
      rating: 4,
      note: "Great service",
      submittedAt: "2026-01-01T00:00:00Z",
      isRead: true,
      isResolved: false,
    },
    requestId: "req-1",
  };
}

const mockApiFetch = api.apiFetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFeedbackDetail", () => {
  it("fetches and returns a feedback item", async () => {
    mockApiFetch.mockResolvedValue(makeResponse("fb-1"));

    const { result } = renderHook(() =>
      useFeedbackDetail("org-a", "fb-1"),
    );

    await act(() => result.current.load());

    expect(result.current.item).not.toBeNull();
    expect(result.current.item!.id).toBe("fb-1");
    expect(result.current.item!.orgId).toBe("org-a");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it("sets notFound on 404", async () => {
    mockApiFetch.mockRejectedValue(
      new api.ApiError("Not found", 404),
    );

    const { result } = renderHook(() =>
      useFeedbackDetail("org-a", "fb-missing"),
    );

    await act(() => result.current.load());

    expect(result.current.notFound).toBe(true);
    expect(result.current.item).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("sets error on non-404 failure", async () => {
    mockApiFetch.mockRejectedValue(
      new api.ApiError("Server error", 500),
    );

    const { result } = renderHook(() =>
      useFeedbackDetail("org-a", "fb-1"),
    );

    await act(() => result.current.load());

    expect(result.current.error).toBe("Server error");
    expect(result.current.notFound).toBe(false);
    expect(result.current.item).toBeNull();
  });

  it("clears state when orgId changes", async () => {
    mockApiFetch.mockResolvedValue(makeResponse("fb-1"));

    const { result, rerender } = renderHook(
      ({ orgId, id }: { orgId: string; id: string }) =>
        useFeedbackDetail(orgId, id),
      { initialProps: { orgId: "org-a", id: "fb-1" } },
    );

    await act(() => result.current.load());
    expect(result.current.item).not.toBeNull();

    rerender({ orgId: "org-b", id: "fb-1" });

    expect(result.current.item).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it("clears state when responseId changes", async () => {
    mockApiFetch.mockResolvedValue(makeResponse("fb-1"));

    const { result, rerender } = renderHook(
      ({ orgId, id }: { orgId: string; id: string }) =>
        useFeedbackDetail(orgId, id),
      { initialProps: { orgId: "org-a", id: "fb-1" } },
    );

    await act(() => result.current.load());
    expect(result.current.item).not.toBeNull();

    rerender({ orgId: "org-a", id: "fb-2" });

    expect(result.current.item).toBeNull();
  });

  it("discards a stale response after orgId changes", async () => {
    let resolveOrgA: (v: unknown) => void;
    const orgAPromise = new Promise((r) => {
      resolveOrgA = r;
    });

    mockApiFetch.mockImplementation((_path: string, orgId: string) => {
      if (orgId === "org-a") return orgAPromise;
      return Promise.resolve(makeResponse("fb-1"));
    });

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string }) =>
        useFeedbackDetail(orgId, "fb-1"),
      { initialProps: { orgId: "org-a" } },
    );

    let orgALoad: Promise<void>;
    act(() => {
      orgALoad = result.current.load();
    });

    rerender({ orgId: "org-b" });
    await act(() => result.current.load());

    expect(result.current.item!.orgId).toBe("org-b");

    await act(async () => {
      resolveOrgA!(makeResponse("fb-stale"));
      await orgALoad!;
    });

    expect(result.current.item!.orgId).toBe("org-b");
  });

  it("discards a stale error after orgId changes", async () => {
    let rejectOrgA: (e: Error) => void;
    const orgAPromise = new Promise((_r, rej) => {
      rejectOrgA = rej;
    });

    mockApiFetch.mockImplementation((_path: string, orgId: string) => {
      if (orgId === "org-a") return orgAPromise;
      return Promise.resolve(makeResponse("fb-1"));
    });

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string }) =>
        useFeedbackDetail(orgId, "fb-1"),
      { initialProps: { orgId: "org-a" } },
    );

    let orgALoad: Promise<void>;
    act(() => {
      orgALoad = result.current.load();
    });

    rerender({ orgId: "org-b" });
    await act(() => result.current.load());

    await act(async () => {
      rejectOrgA!(new api.ApiError("stale error", 500));
      try {
        await orgALoad!;
      } catch {}
    });

    expect(result.current.error).toBeNull();
    expect(result.current.item!.orgId).toBe("org-b");
  });

  it("latest load wins within the same org", async () => {
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

    const { result } = renderHook(() =>
      useFeedbackDetail("org-a", "fb-1"),
    );

    let p1: Promise<void>;
    let p2: Promise<void>;
    act(() => {
      p1 = result.current.load();
    });
    act(() => {
      p2 = result.current.load();
    });

    await act(async () => {
      resolveSecond!(makeResponse("fb-second"));
      await p2!;
    });

    expect(result.current.item!.id).toBe("fb-second");

    await act(async () => {
      resolveFirst!(makeResponse("fb-first-stale"));
      await p1!;
    });

    expect(result.current.item!.id).toBe("fb-second");
  });

  it("is a no-op when orgId is undefined", async () => {
    const { result } = renderHook(() =>
      useFeedbackDetail(undefined, "fb-1"),
    );

    await act(() => result.current.load());

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(result.current.item).toBeNull();
  });
});
