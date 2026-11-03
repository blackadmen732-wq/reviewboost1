import { useCallback, useState } from "react";
import * as Crypto from "expo-crypto";
import { apiFetch, ApiError } from "./api";

/**
 * One Text Request, the website's way (features/dashboard/text-request-
 * composer.tsx, AGENTS.md "SMS"):
 *
 *   number + Tag + approved message → the server's exact preview and whether
 *   this number may be texted → if no agreement is on record, a separate,
 *   explicit "they agreed, like this" → send.
 *
 * Sending never records consent, and nothing here assumes it. Anything that
 * changes who gets the text or what it says throws the preview away, so what
 * is sent is always what was shown. A send whose answer was lost is not
 * retried: the owner is asked to check Recent first.
 */

export interface Eligibility {
  allowed: boolean;
  reason: string | null;
  message: string | null;
}

export interface TextPreview {
  body: string;
  segments: number;
  encoding: string;
  unitCount: number;
  recipientLastFour: string;
  eligibility: Eligibility;
  consentStatement: string;
}

export interface Draft {
  phone: string;
  standId: string;
  templateId: string;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError && error.status > 0) return error.message || "That did not go through. Please try again.";
  return "Could not reach ReviewBoost. Check your connection and try again.";
}

export function useTextComposer(orgId: string | undefined) {
  const [preview, setPreview] = useState<TextPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "consent" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendUncertain, setSendUncertain] = useState(false);
  // One key per preview: a deliberate second press of the same Send is the
  // same request to the server, never a second text.
  const [sendKey, setSendKey] = useState<string | null>(null);

  const clear = useCallback(() => {
    setPreview(null);
    setSendKey(null);
    setError(null);
  }, []);

  const runPreview = useCallback(
    async (draft: Draft) => {
      if (!orgId) return;
      setBusy("preview");
      setError(null);
      try {
        const res = await apiFetch<{ data: TextPreview }>("/api/v1/text-requests/preview", orgId, {
          method: "POST",
          body: JSON.stringify({ phone: draft.phone.trim(), standId: draft.standId, templateId: draft.templateId }),
        });
        setPreview(res.data);
        setSendKey(Crypto.randomUUID());
      } catch (e) {
        setPreview(null);
        setError(messageOf(e));
      } finally {
        setBusy(null);
      }
    },
    [orgId],
  );

  /** "They agreed, like this": recorded only when the owner confirms it. */
  const recordConsent = useCallback(
    async (draft: Draft, method: string, wordingVersion: string) => {
      if (!orgId) return false;
      setBusy("consent");
      setError(null);
      try {
        const res = await apiFetch<{ data: { eligibility: Eligibility } }>("/api/v1/text-requests/consent", orgId, {
          method: "POST",
          body: JSON.stringify({
            phone: draft.phone.trim(),
            standId: draft.standId,
            method,
            wordingVersion,
            confirmed: true,
          }),
        });
        setPreview((current) => (current ? { ...current, eligibility: res.data.eligibility } : current));
        return true;
      } catch (e) {
        setError(messageOf(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [orgId],
  );

  const send = useCallback(
    async (draft: Draft): Promise<boolean> => {
      if (!orgId || !preview || !preview.eligibility.allowed || !sendKey) return false;
      setBusy("send");
      setError(null);
      try {
        await apiFetch("/api/v1/text-requests", orgId, {
          method: "POST",
          body: JSON.stringify({
            phone: draft.phone.trim(),
            standId: draft.standId,
            templateId: draft.templateId,
            idempotencyKey: sendKey,
          }),
        });
        setPreview(null);
        setSendKey(null);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status > 0) setError(messageOf(e));
        else setSendUncertain(true);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [orgId, preview, sendKey],
  );

  const resolveUncertain = useCallback(() => {
    setSendUncertain(false);
    setPreview(null);
    setSendKey(null);
  }, []);

  return { preview, busy, error, sendUncertain, runPreview, recordConsent, send, clear, resolveUncertain };
}
