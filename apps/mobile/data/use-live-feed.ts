import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { apiFetch, ApiError } from "./api";
import type { LiveFeedEntry } from "./types";

interface ApiResponse {
  data: Array<{
    id: string;
    type: "tap" | "feedback";
    locationId: string;
    locationName: string | null;
    rating: number | null;
    submittedAt: string;
  }>;
  meta: { hasMore: boolean; nextCursor: string | null };
  requestId: string;
}

function toEntry(
  row: ApiResponse["data"][number],
  orgId: string,
): LiveFeedEntry {
  return {
    id: row.id,
    orgId,
    locationId: row.locationId,
    type: row.type,
    rating: row.rating,
    submittedAt: row.submittedAt,
    locationName: row.locationName,
  };
}

export function useLiveFeed(orgId: string | undefined) {
  const [items, setItems] = useState<LiveFeedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const fetchingRef = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    setItems([]);
    setError(null);
    setHasMore(false);
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    fetchingRef.current = false;
    cursorRef.current = null;
  }, [orgId]);

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean, reqId: number) => {
      if (!orgId) return;

      const gen = generationRef.current;

      const params = new URLSearchParams();
      // Cursor is opaque — send it back exactly as received. URLSearchParams
      // handles the URL encoding.
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "25");
      const qs = params.toString();

      const res = await apiFetch<ApiResponse>(
        `/api/v1/live-feed?${qs}`,
        orgId,
      );

      if (gen !== generationRef.current) return;
      if (reqId !== requestIdRef.current) return;

      const mapped = res.data.map((r) => toEntry(r, orgId));

      setItems((prev) => {
        if (!append) return mapped;
        // Guard against a repeated response accidentally re-appending the
        // same event ids on top of what we already have.
        const seen = new Set(prev.map((e) => e.id));
        const additions = mapped.filter((e) => !seen.has(e.id));
        return [...prev, ...additions];
      });
      setHasMore(res.meta.hasMore);
      cursorRef.current = res.meta.nextCursor;
    },
    [orgId],
  );

  const load = useCallback(async () => {
    if (!orgId) return;
    const gen = generationRef.current;
    const reqId = ++requestIdRef.current;
    fetchingRef.current = true;
    setLoading(true);
    setRefreshing(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setError(null);
    try {
      await fetchPage(null, false, reqId);
    } catch (e) {
      if (gen !== generationRef.current) return;
      if (reqId !== requestIdRef.current) return;
      setError(e instanceof ApiError ? e.message : "Failed to load activity");
    } finally {
      if (gen === generationRef.current && reqId === requestIdRef.current) {
        fetchingRef.current = false;
        setLoading(false);
      }
    }
  }, [orgId, fetchPage]);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const gen = generationRef.current;
    const reqId = ++requestIdRef.current;
    fetchingRef.current = true;
    setRefreshing(true);
    setLoading(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setError(null);
    try {
      await fetchPage(null, false, reqId);
    } catch (e) {
      if (gen !== generationRef.current) return;
      if (reqId !== requestIdRef.current) return;
      setError(e instanceof ApiError ? e.message : "Failed to refresh");
    } finally {
      if (gen === generationRef.current && reqId === requestIdRef.current) {
        fetchingRef.current = false;
        setRefreshing(false);
      }
    }
  }, [orgId, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!orgId) return;
    if (!hasMore || cursorRef.current === null) return;
    if (loadingMoreRef.current || fetchingRef.current) return;
    const gen = generationRef.current;
    const reqId = requestIdRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await fetchPage(cursorRef.current, true, reqId);
    } catch {
      // Silently fail on load-more; the user can retry by scrolling again.
    } finally {
      if (gen === generationRef.current && reqId === requestIdRef.current) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [orgId, hasMore, fetchPage]);

  const safeItems = useMemo(
    () => (orgId ? items.filter((i) => i.orgId === orgId) : []),
    [items, orgId],
  );

  return {
    items: safeItems,
    loading,
    refreshing,
    error,
    hasMore,
    loadingMore,
    load,
    refresh,
    loadMore,
  };
}
