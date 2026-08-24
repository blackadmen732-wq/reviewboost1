import { useState, useCallback, useRef } from "react";
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

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!orgId) return;

      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "25");
      const qs = params.toString();

      const res = await apiFetch<ApiResponse>(
        `/api/v1/customer-responses?${qs}`,
        orgId,
      );

      const mapped = res.data.map((r) => toFeedbackItem(r, orgId));

      setItems((prev) => (append ? [...prev, ...mapped] : mapped));
      setHasMore(res.meta.hasMore);
      cursorRef.current = res.meta.nextCursor;
    },
    [orgId],
  );

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      await fetchPage(null, false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [orgId, fetchPage]);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setRefreshing(true);
    setError(null);
    try {
      await fetchPage(null, false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }, [orgId, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!orgId || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchPage(cursorRef.current, true);
    } catch {
      // Silently fail on load-more; the user can retry by scrolling again.
    } finally {
      setLoadingMore(false);
    }
  }, [orgId, hasMore, loadingMore, fetchPage]);

  return { items, loading, refreshing, error, hasMore, loadingMore, load, refresh, loadMore };
}
