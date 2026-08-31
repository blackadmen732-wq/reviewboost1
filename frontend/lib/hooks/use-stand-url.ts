"use client";

import { useEffect, useRef, useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/browser";

export function useStandUrl(standId: string | null): {
  standUrl: string | null;
  loading: boolean;
} {
  const [standUrl, setStandUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;

    (async () => {
      if (!standId) {
        setStandUrl(null);
        return;
      }

      setLoading(true);

      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      if (cancelled || generation !== generationRef.current) return;

      if (!session) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          credentials: "omit",
        });
        if (cancelled || generation !== generationRef.current) return;

        if (res.ok) {
          const json = await res.json();
          setStandUrl(json.data?.standUrl ?? null);
        }
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled && generation === generationRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [standId]);

  return { standUrl, loading };
}
