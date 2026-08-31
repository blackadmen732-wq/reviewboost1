import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "./api";
import type { StandItem } from "./types";

interface ApiResponse {
  data: Array<{
    standId: string;
    locationId: string;
    label: string;
    standType: string;
    status: string;
    tokenPrefix: string;
    createdAt: string;
    lastOpenedAt: string | null;
    tokenRotatedAt: string | null;
    nfcUid: string | null;
    nfcProvisionedAt: string | null;
    nfcProvisionedBy: string | null;
  }>;
  requestId: string;
}

export function useStands(orgId: string | undefined) {
  const [stands, setStands] = useState<StandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const fetchStands = useCallback(
    async (isRefresh = false) => {
      if (!orgId) return;

      const gen = ++generationRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await apiFetch<ApiResponse>(
          "/api/v1/review-stands",
          orgId,
        );
        if (gen !== generationRef.current) return;
        setStands(res.data);
      } catch (e) {
        if (gen !== generationRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load stands");
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
    setStands([]);
    setError(null);
    if (orgId) fetchStands();
  }, [orgId, fetchStands]);

  const refresh = useCallback(() => fetchStands(true), [fetchStands]);

  return { stands, loading, refreshing, error, refresh };
}
