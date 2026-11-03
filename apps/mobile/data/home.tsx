import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch, ApiError } from "./api";
import { useAuth } from "./auth-context";

/**
 * The owner's Home: GET /api/v1/home, the website's own Home model and words.
 * One copy for the whole app, so the Feedback tab's badge and Home's
 * "8 new ratings" are the same number, and opening a rating can bring both
 * down at once.
 */

export type AttentionKind =
  | "plan"
  | "payment"
  | "google"
  | "google-upgrade"
  | "unread"
  | "unsorted"
  | "tag-missing"
  | "tag-unprogrammed"
  | "tag-rewrite";

export interface HomeAttention {
  kind: AttentionKind;
  title: string;
  body: string;
}

export interface HomeSetupStep {
  key: string;
  number: number;
  title: string;
  body: string;
  done: boolean;
  action: { label: string; href: string } | null;
}

export interface HomeData {
  businessName: string;
  unreadCount: number;
  model: {
    kind: "empty" | "active";
    setup: HomeSetupStep[] | null;
    photoNudge: boolean;
    planNote: { title: string; href: string | null } | null;
    attentions: HomeAttention[];
    primary: { label: string; href: string } | null;
    tagStatus: { total: number; live: number; programmed: number; needsRewrite: number };
    week: { count: number; change: string | null } | null;
  };
  insights: { average: string; total: number; direction: string | null } | null;
  tagStatusLine: string;
  unread: Array<{
    id: string;
    rating: number;
    submittedAt: string;
    isRead: boolean;
    isResolved: boolean;
    hasNote: boolean;
    tagLabel: string | null;
  }>;
}

interface HomeState {
  home: HomeData | null;
  loading: boolean;
  error: string | null;
  /** How many ratings nobody has opened yet, for the Feedback tab's badge. */
  unreadCount: number;
  refresh: () => Promise<void>;
}

const HomeContext = createContext<HomeState | null>(null);

export function HomeProvider({ children }: { children: ReactNode }) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId;
  const [home, setHome] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  // A different business is a different Home: nothing of the last one shows.
  useEffect(() => {
    generation.current += 1;
    setHome(null);
    setError(null);
    setLoading(false);
  }, [orgId]);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: HomeData }>("/api/v1/home", orgId);
      if (gen !== generation.current) return;
      setHome(res.data);
    } catch (e) {
      if (gen !== generation.current) return;
      // A failed read is said, never shown as an empty Home (AGENTS.md).
      setError(e instanceof ApiError && e.status !== 0 ? e.message : "Couldn’t load Home. Check your connection and try again.");
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [orgId]);

  const unreadCount = home?.unreadCount ?? 0;

  return (
    <HomeContext.Provider value={{ home, loading, error, unreadCount, refresh }}>{children}</HomeContext.Provider>
  );
}

export function useHome(): HomeState {
  const ctx = useContext(HomeContext);
  if (!ctx) throw new Error("useHome must be used within HomeProvider");
  return ctx;
}
