import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch, ApiError } from "./api";
import type { FeedbackItem } from "./types";

interface ApiResponse {
  data: {
    responseId: string;
    locationId: string;
    rating: number;
    note: string | null;
    submittedAt: string;
    isRead: boolean;
    isResolved: boolean;
  };
  requestId: string;
}

export function useFeedbackDetail(
  orgId: string | undefined,
  responseId: string | undefined,
) {
  const [item, setItem] = useState<FeedbackItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setItem(null);
    setError(null);
    setNotFound(false);
    setLoading(false);
  }, [orgId, responseId]);

  const load = useCallback(async () => {
    if (!orgId || !responseId) return;
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await apiFetch<ApiResponse>(
        `/api/v1/customer-responses/${responseId}`,
        orgId,
      );
      if (reqId !== requestIdRef.current) return;
      const d = res.data;
      setItem({
        id: d.responseId,
        orgId,
        locationId: d.locationId,
        rating: d.rating,
        note: d.note,
        submittedAt: d.submittedAt,
        isRead: d.isRead,
        isResolved: d.isResolved,
      });
    } catch (e) {
      if (reqId !== requestIdRef.current) return;
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError(
          e instanceof ApiError ? e.message : "Failed to load feedback",
        );
      }
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, responseId]);

  return { item, loading, error, notFound, load };
}
