import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "./api";
import type { StandItem } from "./types";
import { loadFailed } from "./recovery";

interface ApiResponse {
  data: Array<{
    standId: string;
    locationId: string;
    locationName: string | null;
    label: string;
    standType: string;
    status: string;
    tokenPrefix: string;
    createdAt: string;
    lastOpenedAt: string | null;
    tokenRotatedAt: string | null;
    nfcProvisionedAt: string | null;
    placeHasGoogleLink?: boolean;
  }>;
  requestId: string;
}

/**
 * The last list each business's Tags came back as, for this run of the app.
 * A screen that mounts again (the Tag screen, the tab after a reload of the
 * navigator) starts from it instead of from nothing, and a refresh that fails
 * leaves it on screen: an owner whose shop wifi drops keeps their Tags.
 */
const lastLists = new Map<string, StandItem[]>();

/** For tests: start from nothing again. */
export function forgetStandLists(): void {
  lastLists.clear();
}

export function useStands(orgId: string | undefined) {
  const [stands, setStands] = useState<StandItem[]>(() => (orgId ? (lastLists.get(orgId) ?? []) : []));
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
        lastLists.set(orgId, res.data);
        setStands(res.data);
      } catch (e) {
        if (gen !== generationRef.current) return;
        setError(loadFailed(e, "your Tags"));
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
    // Another business's Tags never show; this one's last list does.
    setStands(orgId ? (lastLists.get(orgId) ?? []) : []);
    setError(null);
    if (orgId) fetchStands();
  }, [orgId, fetchStands]);

  const refresh = useCallback(() => fetchStands(true), [fetchStands]);

  return { stands, loading, refreshing, error, refresh };
}
