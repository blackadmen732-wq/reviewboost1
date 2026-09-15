import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "./api";

export type PlanId = "starter" | "growth" | "pro";
export type BillingStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "suspended";

export interface BillingState {
  planId: PlanId | null;
  status: BillingStatus;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  smsBalance: { monthly: number; purchased: number; total: number };
  plans: Record<PlanId, { locations: number; tags: number; monthlySmsSegments: number; priceUsdCents: number }>;
}

interface ApiResponse {
  data: BillingState;
  requestId: string;
}

/**
 * Billing state, from the backend and nowhere else.
 *
 * `billing` stays null until the fetch returns. There is no placeholder plan,
 * no assumed trial, and no invented balance — a screen that fills those in
 * tells an owner they are subscribed when they may not be.
 */
export function useBilling(orgId: string | undefined) {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const fetchBilling = useCallback(
    async (isRefresh = false) => {
      if (!orgId) return;

      const gen = ++generationRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await apiFetch<ApiResponse>("/api/v1/billing", orgId);
        if (gen !== generationRef.current) return;
        setBilling(res.data);
      } catch (e) {
        if (gen !== generationRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load billing");
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
    setBilling(null);
    setError(null);
    if (orgId) fetchBilling();
  }, [orgId, fetchBilling]);

  const refresh = useCallback(() => fetchBilling(true), [fetchBilling]);

  return { billing, loading, refreshing, error, refresh };
}
