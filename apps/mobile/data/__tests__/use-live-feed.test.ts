/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveFeed } from "../use-live-feed";
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

interface RowInit {
  id: string;
  type?: "tap" | "feedback";
  locationId?: string;
  locationName?: string | null;
  rating?: number | null;
  submittedAt?: string;
}

function makeResponse(
  rows: Array<string | RowInit>,
  hasMore = false,
  nextCursor: string | null = null,
) {
  return {
    data: rows.map((r) => {
      const row: RowInit = typeof r === "string" ? { id: r } : r;
      return {
        id: row.id,
        type: row.type ?? "tap",
        locationId: row.locationId ?? "loc-1",
        // Preserve an explicit null; only fall back when the key was omitted.
        locationName: "locationName" in row ? row.locationName : "Downtown",
        rating: row.rating ?? null,
        submittedAt: row.submittedAt ?? "2026-01-01T00:00:00Z",
      };
    }),
    meta: { hasMore, nextCursor },
    requestId: "req-1",
  };
}

const mockApiFetch = api.apiFetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLiveFeed", () => {
  it("initial load hits /api/v1/live-feed with the active orgId", async () => {
    mockApiFetch.mockResolvedValue(makeResponse([{ id: "e-1" }]));

    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const [path, orgId] = mockApiFetch.mock.calls[0]!;
    expect(path).toMatch(/^\/api\/v1\/live-feed\?/);
    expect(orgId).toBe("org-a");
    expect(result.current.items).toHaveLength(1);
  });

  it("maps a tap event with null rating", async () => {
    mockApiFetch.mockResolvedValue(
      makeResponse([{ id: "t-1", type: "tap", rating: null, locationName: "Downtown" }]),
    );

    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    const item = result.current.items[0]!;
    expect(item.type).toBe("tap");
    expect(item.rating).toBeNull();
    expect(item.locationName).toBe("Downtown");
    expect(item.orgId).toBe("org-a");
  });

  it("maps a feedback event with rating", async () => {
    mockApiFetch.mockResolvedValue(
      makeResponse([{ id: "f-1", type: "feedback", rating: 4, locationName: "Airport" }]),
    );

    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    const item = result.current.items[0]!;
    expect(item.type).toBe("feedback");
    expect(item.rating).toBe(4);
    expect(item.locationName).toBe("Airport");
  });

  it("preserves a null locationName through mapping (no crash, no 'null' string)", async () => {
    mockApiFetch.mockResolvedValue(
      makeResponse([{ id: "e-1", locationName: null }]),
    );

    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    expect(result.current.items[0]!.locationName).toBeNull();
  });

  it("empty response yields no items and no error", async () => {
    mockApiFetch.mockResolvedValue(makeResponse([]));

    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an ApiError message when the request fails", async () => {
    mockApiFetch.mockRejectedValue(new api.ApiError("Server down", 503));

    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    expect(result.current.error).toBe("Server down");
    expect(result.current.items).toHaveLength(0);
  });

  it("retry after an error succeeds and clears the error", async () => {
    mockApiFetch.mockRejectedValueOnce(new api.ApiError("Boom", 500));
    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());
    expect(result.current.error).toBe("Boom");

    mockApiFetch.mockResolvedValueOnce(makeResponse([{ id: "e-1" }]));
    await act(() => result.current.load());

    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });

  it("refresh replaces items rather than appending", async () => {
    mockApiFetch.mockResolvedValueOnce(makeResponse([{ id: "old-1" }, { id: "old-2" }]));
    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());
    expect(result.current.items.map((i) => i.id)).toEqual(["old-1", "old-2"]);

    mockApiFetch.mockResolvedValueOnce(makeResponse([{ id: "new-1" }]));
    await act(() => result.current.refresh());

    expect(result.current.items.map((i) => i.id)).toEqual(["new-1"]);
  });

  it("loadMore sends the opaque nextCursor back exactly as received and appends", async () => {
    const opaque = "eyJ2IjoxLCJ0Ijp7InMiOiIyMDI2LTAxLTAxVDAwOjAwOjAwWiIsImkiOiJ4In19";
    mockApiFetch.mockResolvedValueOnce(makeResponse([{ id: "p1-1" }], true, opaque));
    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());
    expect(result.current.hasMore).toBe(true);

    mockApiFetch.mockResolvedValueOnce(makeResponse([{ id: "p2-1" }]));
    await act(() => result.current.loadMore());

    expect(result.current.items.map((i) => i.id)).toEqual(["p1-1", "p2-1"]);
    const secondPath = mockApiFetch.mock.calls[1]![0] as string;
    // URL-encoded, but the cursor value is preserved verbatim.
    expect(decodeURIComponent(secondPath)).toContain(`cursor=${opaque}`);
  });

  it("hasMore=false blocks loadMore", async () => {
    mockApiFetch.mockResolvedValueOnce(makeResponse([{ id: "e-1" }], false, null));
    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    const callsBefore = mockApiFetch.mock.calls.length;
    await act(() => result.current.loadMore());
    expect(mockApiFetch.mock.calls.length).toBe(callsBefore);
  });

  it("null nextCursor blocks loadMore even if hasMore were somehow true", async () => {
    // Explicit belt: cursor is null → loadMore is a no-op.
    mockApiFetch.mockResolvedValueOnce(makeResponse([{ id: "e-1" }], true, null));
    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    const callsBefore = mockApiFetch.mock.calls.length;
    await act(() => result.current.loadMore());
    expect(mockApiFetch.mock.calls.length).toBe(callsBefore);
  });

  it("guards duplicate concurrent loadMore calls", async () => {
    mockApiFetch.mockResolvedValueOnce(
      makeResponse([{ id: "e-1" }], true, "cursor-1"),
    );
    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());
    expect(result.current.hasMore).toBe(true);

    let resolveMore: (v: unknown) => void;
    mockApiFetch.mockImplementation(() => new Promise((r) => { resolveMore = r; }));

    act(() => {
      result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });
    // Only load() + first loadMore should have been made.
    expect(mockApiFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveMore!(makeResponse([{ id: "e-2" }]));
    });
    expect(result.current.loadingMore).toBe(false);
  });

  it("organization switch clears items, error, hasMore, and cursor", async () => {
    mockApiFetch.mockResolvedValue(
      makeResponse([{ id: "a-1" }, { id: "a-2" }], true, "cursor-a"),
    );

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | undefined }) => useLiveFeed(orgId),
      { initialProps: { orgId: "org-a" } },
    );

    await act(() => result.current.load());
    expect(result.current.items).toHaveLength(2);
    expect(result.current.hasMore).toBe(true);

    rerender({ orgId: "org-b" });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it("an old-org late response never leaks into the new-org view", async () => {
    let resolveOrgA: (v: unknown) => void;
    const orgAPromise = new Promise((r) => {
      resolveOrgA = r;
    });

    mockApiFetch.mockImplementation((_path: string, orgId: string) => {
      if (orgId === "org-a") return orgAPromise;
      return Promise.resolve(makeResponse([{ id: "b-1" }]));
    });

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | undefined }) => useLiveFeed(orgId),
      { initialProps: { orgId: "org-a" } },
    );

    let loadPromiseA: Promise<void>;
    act(() => {
      loadPromiseA = result.current.load();
    });

    rerender({ orgId: "org-b" });
    await act(() => result.current.load());

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.orgId).toBe("org-b");

    await act(async () => {
      resolveOrgA!(makeResponse([{ id: "a-stale-1" }, { id: "a-stale-2" }]));
      await loadPromiseA!;
    });

    for (const item of result.current.items) {
      expect(item.orgId).toBe("org-b");
    }
    expect(result.current.items).toHaveLength(1);
  });

  it("a stale loadMore response does not append after refresh", async () => {
    mockApiFetch.mockResolvedValueOnce(
      makeResponse([{ id: "e-1" }], true, "cursor-1"),
    );

    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());
    expect(result.current.items).toHaveLength(1);

    let resolveMore: (v: unknown) => void;
    let count = 0;
    mockApiFetch.mockImplementation(() => {
      count++;
      if (count === 1) return new Promise((r) => { resolveMore = r; });
      return Promise.resolve(makeResponse([{ id: "refreshed" }]));
    });

    let moreP: Promise<void>;
    act(() => {
      moreP = result.current.loadMore();
    });

    await act(() => result.current.refresh());
    expect(result.current.items.map((i) => i.id)).toEqual(["refreshed"]);

    await act(async () => {
      resolveMore!(makeResponse([{ id: "stale-page-2" }]));
      await moreP!;
    });

    expect(result.current.items.map((i) => i.id)).toEqual(["refreshed"]);
  });

  it("does not append duplicate event ids if a page repeats", async () => {
    mockApiFetch.mockResolvedValueOnce(
      makeResponse([{ id: "e-1" }, { id: "e-2" }], true, "cursor-1"),
    );
    const { result } = renderHook(() => useLiveFeed("org-a"));
    await act(() => result.current.load());

    // A misbehaving upstream repeats e-2 and adds a fresh e-3.
    mockApiFetch.mockResolvedValueOnce(
      makeResponse([{ id: "e-2" }, { id: "e-3" }]),
    );
    await act(() => result.current.loadMore());

    expect(result.current.items.map((i) => i.id)).toEqual(["e-1", "e-2", "e-3"]);
  });
});
