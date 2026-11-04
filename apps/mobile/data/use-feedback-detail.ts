import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch, ApiError } from "./api";
import { checkOutcome, isServerError, type IsDone } from "./recovery";
import type { FeedbackItem, OwnerNote } from "./types";
import { loadFailed } from "./recovery";

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
 * How an action ended. `stillUnknown`: ReviewBoost could not be reached to
 * find out, so the screen keeps checking with it (`OutcomeCheckNotice`) and
 * holds the action meanwhile.
 */
export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; stillUnknown?: IsDone };

function toDetail(orgId: string, d: ApiResponse["data"]): FeedbackDetail {
  return {
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
      const next = toDetail(orgId, res.data);
      setItem(next);
      return next;
    } catch (e) {
      if (reqId !== requestIdRef.current) return null;
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError(loadFailed(e, "this rating"));
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
   * Read the rating for a check: what is stored now, shown as it is. Throws
   * when ReviewBoost cannot be reached, so the check knows it got no answer.
   */
  const readForCheck = useCallback(
    async (signal: AbortSignal): Promise<FeedbackDetail> => {
      if (!orgId || !responseId) throw new Error("No rating to read.");
      const res = await apiFetch<ApiResponse>(`/api/v1/customer-responses/${responseId}`, orgId, { signal });
      const next = toDetail(orgId, res.data);
      setItem(next);
      return next;
    },
    [orgId, responseId],
  );

  /**
   * Sorted, or not after all. When the answer is lost, the rating is read
   * back rather than the change sent again (a write is never replayed by
   * itself): the screen shows what is actually stored.
   */
  const setResolved = useCallback(
    async (resolved: boolean): Promise<ActionResult> => {
      if (!orgId || !responseId) return { ok: false, message: "Please try again." };
      try {
        await apiFetch(`/api/v1/customer-responses/${responseId}/resolve`, orgId, {
          method: "POST",
          body: JSON.stringify({ resolved }),
        });
        setItem((current) => (current && current.id === responseId ? { ...current, isResolved: resolved } : current));
        return { ok: true };
      } catch (e) {
        if (answered(e) && !isServerError(e)) return { ok: false, message: "Could not save that. Please try again." };
        const stored: IsDone = async (signal) => (await readForCheck(signal)).isResolved === resolved;
        const outcome = await checkOutcome(stored, { serverAnswered: isServerError(e) }).catch(() => "unknown" as const);
        if (outcome === "done") return { ok: true };
        if (outcome === "not-done") return { ok: false, message: "Could not save that. Please try again." };
        return { ok: false, message: "No answer from ReviewBoost yet.", stillUnknown: stored };
      }
    },
    [orgId, responseId, readForCheck],
  );

  /**
   * "What we did": a note only the team sees. Append-only, so a request whose
   * answer was lost is looked for among the saved notes, never sent twice.
   */
  const addNote = useCallback(
    async (body: string): Promise<ActionResult> => {
      const text = body.trim();
      if (!text) return { ok: false, message: "Write what you did first, then save it." };
      if (!orgId || !responseId) return { ok: false, message: "Please try again." };
      const before = new Set((item?.notes ?? []).map((note) => note.id));
      try {
        await apiFetch(`/api/v1/customer-responses/${responseId}/notes`, orgId, {
          method: "POST",
          body: JSON.stringify({ body: text }),
        });
        await fetchDetail();
        return { ok: true };
      } catch (e) {
        if (answered(e) && !isServerError(e)) return { ok: false, message: "Could not save that. Your text is still here." };
        const saved: IsDone = async (signal) => {
          const now = await readForCheck(signal);
          return now.notes.some((note) => note.body === text && !before.has(note.id));
        };
        const outcome = await checkOutcome(saved, { serverAnswered: isServerError(e) }).catch(() => "unknown" as const);
        if (outcome === "done") return { ok: true };
        if (outcome === "not-done") {
          return { ok: false, message: "That note didn’t save. Your text is still here. Try again." };
        }
        return { ok: false, message: "No answer from ReviewBoost yet.", stillUnknown: saved };
      }
    },
    [orgId, responseId, item?.notes, fetchDetail, readForCheck],
  );

  return { item, loading, error, notFound, load, markRead, setResolved, addNote };
}
