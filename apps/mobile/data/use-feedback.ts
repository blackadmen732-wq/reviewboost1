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
        "id, org_id, location_id, rating, note_encrypted, submitted_at, read_at, resolved_at",
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

    const rows = data ?? [];
    const ids = rows.map((row) => row.id as string);

    const noteCounts = new Map<string, number>();
    if (ids.length > 0) {
      const noteResult = await supabase
        .from("response_notes")
        .select("response_id")
        .eq("org_id", activeOrg.orgId)
        .in("response_id", ids);

      if (gen !== generation.current) return;

      for (const row of noteResult.data ?? []) {
        const key = row.response_id as string;
        noteCounts.set(key, (noteCounts.get(key) ?? 0) + 1);
      }
    }

    const mapped: FeedbackItem[] = rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        orgId: row.org_id as string,
        locationId: row.location_id as string,
        rating: row.rating as number,
        note: row.note_encrypted ? "[encrypted]" : null,
        submittedAt: row.submitted_at as string,
        isRead: row.read_at !== null,
        isResolved: row.resolved_at !== null,
        noteCount: noteCounts.get(row.id as string) ?? 0,
      }),
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
          .select("id, org_id, location_id, rating, note_encrypted, submitted_at, read_at, resolved_at")
          .eq("id", id)
          .eq("org_id", activeOrg.orgId)
          .single(),
        supabase
          .from("response_notes")
          .select("id, response_id, body_encrypted, created_at, author_id")
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
      const noteRows = notesResult.data ?? [];

      const authorIds = [...new Set(noteRows.map((n) => n.author_id as string))];
      const profileMap = new Map<string, string>();
      if (authorIds.length > 0) {
        const profileResult = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", authorIds);

        if (cancelled) return;

        for (const p of profileResult.data ?? []) {
          profileMap.set(p.id as string, (p.display_name as string) ?? "Unknown");
        }
      }

      setItem({
        id: row.id,
        orgId: row.org_id,
        locationId: row.location_id,
        rating: row.rating,
        note: row.note_encrypted ? "[encrypted]" : null,
        submittedAt: row.submitted_at,
        isRead: row.read_at !== null,
        isResolved: row.resolved_at !== null,
        noteCount: noteRows.length,
      });

      const mappedNotes: OwnerNote[] = noteRows.map(
        (n: Record<string, unknown>) => ({
          id: n.id as string,
          feedbackId: n.response_id as string,
          body: n.body_encrypted ? "[encrypted]" : "",
          createdAt: n.created_at as string,
          authorName: profileMap.get(n.author_id as string) ?? "Unknown",
        }),
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
    const { error: err } = await supabase.rpc("rpc_mark_response_read", { p_response_id: id });
    if (!err) setItem((prev) => (prev ? { ...prev, isRead: true } : prev));
  }, [id]);

  const resolve = useCallback(async () => {
    if (!id) return;
    const { error: err } = await supabase.rpc("rpc_resolve_response", { p_response_id: id });
    if (!err) setItem((prev) => (prev ? { ...prev, isResolved: true } : prev));
  }, [id]);

  const reopen = useCallback(async () => {
    if (!id) return;
    const { error: err } = await supabase.rpc("rpc_reopen_response", { p_response_id: id });
    if (!err) setItem((prev) => (prev ? { ...prev, isResolved: false } : prev));
  }, [id]);

  return { item, notes, loading, error, markRead, resolve, reopen };
}
