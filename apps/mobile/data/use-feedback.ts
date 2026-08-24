import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { apiFetch, ApiError } from "./api";
import type { FeedbackItem } from "./types";

interface ApiResponse {
  data: Array<{
    responseId: string;
    locationId: string;
    rating: number;
    note: string | null;
    submittedAt: string;
    isRead: boolean;
    isResolved: boolean;
  }>;
  meta: { hasMore: boolean; nextCursor: string | null };
  requestId: string;
}

function toFeedbackItem(
  row: ApiResponse["data"][number],
  orgId: string,
): FeedbackItem {
  return {
    id: row.responseId,
    orgId,
    locationId: row.locationId,
    rating: row.rating,
    note: row.note,
    submittedAt: row.submittedAt,
    isRead: row.isRead,
    isResolved: row.isResolved,
  };
}

export function useFeedback(orgId: string | undefined) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    setItems([]);
    setError(null);
    setHasMore(false);
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    cursorRef.current = null;
  }, [orgId]);

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!orgId) return;

      const gen = generationRef.current;
      const reqId = ++requestIdRef.current;

      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "25");
      const qs = params.toString();

      const res = await apiFetch<ApiResponse>(
        `/api/v1/customer-responses?${qs}`,
        orgId,
      );

      if (gen !== generationRef.current) return;
      if (reqId !== requestIdRef.current && !append) return;

      const mapped = res.data.map((r) => toFeedbackItem(r, orgId));

      setItems((prev) => (append ? [...prev, ...mapped] : mapped));
      setHasMore(res.meta.hasMore);
      cursorRef.current = res.meta.nextCursor;
    },
    [orgId],
  );

  const load = useCallback(async () => {
    if (!orgId) return;
    const gen = generationRef.current;
    setLoading(true);
    setError(null);
    try {
      await fetchPage(null, false);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof ApiError ? e.message : "Failed to load feedback");
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [orgId, fetchPage]);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const gen = generationRef.current;
    setRefreshing(true);
    setError(null);
    try {
      await fetchPage(null, false);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof ApiError ? e.message : "Failed to refresh");
    } finally {
      if (gen === generationRef.current) setRefreshing(false);
    }
  }, [orgId, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!orgId || !hasMore || loadingMoreRef.current) return;
    const gen = generationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await fetchPage(cursorRef.current, true);
    } catch {
      // Silently fail on load-more; the user can retry by scrolling again.
    } finally {
      if (gen === generationRef.current) {
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
