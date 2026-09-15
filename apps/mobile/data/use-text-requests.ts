import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "./api";

export interface SmsBalance {
  monthly: number;
  purchased: number;
  total: number;
}

export interface TextRequestItem {
  id: string;
  status: string;
  segments: number;
  recipientLastFour: string | null;
  scheduledFor: string;
  createdAt: string;
}

interface ApiResponse {
  data: { items: TextRequestItem[]; balance: SmsBalance };
  requestId: string;
}

/**
 * Text Requests, with the balance the ledger reports.
 *
 * `balance` starts null rather than zero. Zero is a real state — a trial has
 * no messages at all — and a screen that shows it before the fetch returns is
 * telling an owner something untrue about their account.
 */
export function useTextRequests(orgId: string | undefined) {
  const [items, setItems] = useState<TextRequestItem[]>([]);
  const [balance, setBalance] = useState<SmsBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const fetchAll = useCallback(
    async (isRefresh = false) => {
      if (!orgId) return;

      const gen = ++generationRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await apiFetch<ApiResponse>("/api/v1/text-requests", orgId);
        if (gen !== generationRef.current) return;
        setItems(res.data.items);
        setBalance(res.data.balance);
      } catch (e) {
        if (gen !== generationRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load Text Requests");
      } finally {
        if (gen === generationRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [orgId],
  );

  useEffect(() => {
    generationRef.current += 1;
    setItems([]);
    setBalance(null);
    setError(null);
    if (orgId) fetchAll();
  }, [orgId, fetchAll]);

  const refresh = useCallback(() => fetchAll(true), [fetchAll]);

  return { items, balance, loading, refreshing, error, refresh };
}
