import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch, ApiError } from "./api";
import type { FeedbackItem, OwnerNote } from "./types";

interface ApiResponse {
  data: {
    responseId: string;
    locationId: string;
    rating: number;
    note: string | null;
    submittedAt: string;
    isRead: boolean;
    isResolved: boolean;
    /** Which Tag it came from. Absent from servers older than the app. */
    tagLabel?: string | null;
    notes?: Array<{ noteId: string; body: string; authorName: string; createdAt: string }>;
  };
  requestId: string;
}

export interface FeedbackDetail extends FeedbackItem {
  tagLabel: string | null;
  notes: OwnerNote[];
}

/**
 * A server that answered said no; anything else (no connection, a deadline)
 * leaves it unknown whether the write happened, so it is never retried blind
 * (AGENTS.md: reconcile before retrying an append).
 */
function answered(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status > 0;
}

export function useFeedbackDetail(
  orgId: string | undefined,
  responseId: string | undefined,
) {
  const [item, setItem] = useState<FeedbackDetail | null>(null);
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

  /** Read the rating. Resolves to what was read, or null if it could not be. */
  const fetchDetail = useCallback(async (): Promise<FeedbackDetail | null> => {
    if (!orgId || !responseId) return null;
    const reqId = ++requestIdRef.current;
    setError(null);
    setNotFound(false);
    try {
      const res = await apiFetch<ApiResponse>(
        `/api/v1/customer-responses/${responseId}`,
        orgId,
      );
      if (reqId !== requestIdRef.current) return null;
      const d = res.data;
      const next: FeedbackDetail = {
        id: d.responseId,
        orgId,
        locationId: d.locationId,
        rating: d.rating,
        note: d.note,
        submittedAt: d.submittedAt,
        isRead: d.isRead,
        isResolved: d.isResolved,
        tagLabel: d.tagLabel ?? null,
        notes: (d.notes ?? []).map((note) => ({
          id: note.noteId,
          feedbackId: d.responseId,
          body: note.body,
          authorName: note.authorName,
          createdAt: note.createdAt,
        })),
      };
      setItem(next);
      return next;
    } catch (e) {
      if (reqId !== requestIdRef.current) return null;
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError(
          e instanceof ApiError ? e.message : "Failed to load feedback",
        );
      }
      return null;
    }
  }, [orgId, responseId]);

  const load = useCallback(async () => {
    if (!orgId || !responseId) return;
    const reqId = requestIdRef.current + 1;
    setLoading(true);
    try {
      await fetchDetail();
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [orgId, responseId, fetchDetail]);

  /**
   * Opening a rating is reading it, as on the website. Idempotent, so a lost
   * answer costs nothing: the dot simply stays until the next look.
   */
  const markRead = useCallback(async (): Promise<boolean> => {
    if (!orgId || !responseId) return false;
    try {
      await apiFetch(`/api/v1/customer-responses/${responseId}/read`, orgId, { method: "POST", body: "{}" });
      setItem((current) => (current && current.id === responseId ? { ...current, isRead: true } : current));
      return true;
    } catch {
      return false;
    }
  }, [orgId, responseId]);

  /**
   * Sorted, or not after all. Setting a state is safe to repeat, but an
   * unanswered request is still checked against the server rather than
   * assumed: the screen shows what is actually stored.
   */
  const setResolved = useCallback(
    async (resolved: boolean): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (!orgId || !responseId) return { ok: false, message: "Please try again." };
      try {
        await apiFetch(`/api/v1/customer-responses/${responseId}/resolve`, orgId, {
          method: "POST",
          body: JSON.stringify({ resolved }),
        });
        setItem((current) => (current && current.id === responseId ? { ...current, isResolved: resolved } : current));
        return { ok: true };
      } catch (e) {
        if (answered(e)) return { ok: false, message: "Could not save that. Please try again." };
        const now = await fetchDetail();
        if (now && now.isResolved === resolved) return { ok: true };
        return { ok: false, message: "Could not confirm that change. Check the rating before trying again." };
      }
    },
    [orgId, responseId, fetchDetail],
  );

  /**
   * "What we did": a note only the team sees. Append-only, so a request whose
   * answer was lost is reconciled against the saved notes, never sent twice.
   */
  const addNote = useCallback(
    async (body: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      const text = body.trim();
      if (!text) return { ok: false, message: "Write what you did first, then save it." };
      if (!orgId || !responseId) return { ok: false, message: "Please try again." };
      const before = item?.notes.length ?? 0;
      try {
        await apiFetch(`/api/v1/customer-responses/${responseId}/notes`, orgId, {
          method: "POST",
          body: JSON.stringify({ body: text }),
        });
        await fetchDetail();
        return { ok: true };
      } catch (e) {
        if (answered(e)) return { ok: false, message: "Could not save that. Your text is still here." };
        const now = await fetchDetail();
        if (now && now.notes.length > before && now.notes.some((note) => note.body === text)) return { ok: true };
        return {
          ok: false,
          message: "Could not confirm saving. Your text is still here. Check the saved notes before sending it again.",
        };
      }
    },
    [orgId, responseId, item?.notes.length, fetchDetail],
  );

  return { item, loading, error, notFound, load, markRead, setResolved, addNote };
}
