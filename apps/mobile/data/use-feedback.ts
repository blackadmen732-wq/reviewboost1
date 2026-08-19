import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";
import type { FeedbackItem, OwnerNote } from "./types";

export function useFeedbackList() {
  const { activeOrg } = useAuth();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const fetch = useCallback(async () => {
    if (!activeOrg) {
      setItems([]);
      return;
    }

    const gen = ++generation.current;
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("customer_responses")
      .select(
        "id, rating, note_encrypted, submitted_at, read_at, resolved_at, response_notes(count)",
      )
      .eq("org_id", activeOrg.orgId)
      .order("submitted_at", { ascending: false })
      .limit(100);

    if (gen !== generation.current) return;

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const mapped: FeedbackItem[] = (data ?? []).map(
      (row: Record<string, unknown>) => {
        const notesAgg = row.response_notes as
          | { count: number }[]
          | undefined;
        return {
          id: row.id as string,
          rating: row.rating as number,
          note: row.note_encrypted ? "[encrypted]" : null,
          submittedAt: row.submitted_at as string,
          isRead: row.read_at !== null,
          isResolved: row.resolved_at !== null,
          noteCount: notesAgg?.[0]?.count ?? 0,
        };
      },
    );

    setItems(mapped);
    setLoading(false);
  }, [activeOrg?.orgId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { items, loading, error, refetch: fetch };
}

export function useFeedbackDetail(id: string | undefined) {
  const { activeOrg } = useAuth();
  const [item, setItem] = useState<FeedbackItem | null>(null);
  const [notes, setNotes] = useState<OwnerNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !activeOrg) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const [responseResult, notesResult] = await Promise.all([
        supabase
          .from("customer_responses")
          .select("id, rating, note_encrypted, submitted_at, read_at, resolved_at")
          .eq("id", id)
          .eq("org_id", activeOrg.orgId)
          .single(),
        supabase
          .from("response_notes")
          .select("id, response_id, body_encrypted, created_at, author_id, profiles(display_name)")
          .eq("response_id", id)
          .eq("org_id", activeOrg.orgId)
          .order("created_at", { ascending: true }),
      ]);

      if (cancelled) return;

      if (responseResult.error) {
        setError(responseResult.error.message);
        setLoading(false);
        return;
      }

      const row = responseResult.data;
      setItem({
        id: row.id,
        rating: row.rating,
        note: row.note_encrypted ? "[encrypted]" : null,
        submittedAt: row.submitted_at,
        isRead: row.read_at !== null,
        isResolved: row.resolved_at !== null,
        noteCount: notesResult.data?.length ?? 0,
      });

      const mappedNotes: OwnerNote[] = (notesResult.data ?? []).map(
        (n: Record<string, unknown>) => {
          const profile = n.profiles as
            | { display_name: string | null }
            | { display_name: string | null }[]
            | null;
          const p = Array.isArray(profile) ? profile[0] : profile;
          return {
            id: n.id as string,
            feedbackId: n.response_id as string,
            body: n.body_encrypted ? "[encrypted]" : "",
            createdAt: n.created_at as string,
            authorName: p?.display_name ?? "Unknown",
          };
        },
      );
      setNotes(mappedNotes);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, activeOrg?.orgId]);

  const markRead = useCallback(async () => {
    if (!id) return;
    await supabase.rpc("rpc_mark_response_read", { p_response_id: id });
    setItem((prev) => (prev ? { ...prev, isRead: true } : prev));
  }, [id]);

  const resolve = useCallback(async () => {
    if (!id) return;
    await supabase.rpc("rpc_resolve_response", { p_response_id: id });
    setItem((prev) => (prev ? { ...prev, isResolved: true } : prev));
  }, [id]);

  const reopen = useCallback(async () => {
    if (!id) return;
    await supabase.rpc("rpc_reopen_response", { p_response_id: id });
    setItem((prev) => (prev ? { ...prev, isResolved: false } : prev));
  }, [id]);

  return { item, notes, loading, error, markRead, resolve, reopen };
}
