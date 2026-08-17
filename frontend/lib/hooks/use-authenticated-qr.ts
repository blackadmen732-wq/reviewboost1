"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

async function fetchQrBlob(standId: string, accessToken: string): Promise<Blob> {
  const res = await fetch(`/api/v1/review-stands/${standId}/qr`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "omit",
  });
  if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
  if (!res.ok) throw new Error("qr_failed");
  return res.blob();
}

type QrStatus = "idle" | "loading" | "ready" | "expired" | "error";

export interface AuthenticatedQr {
  objectUrl: string | null;
  status: QrStatus;
  reload: () => void;
  download: (filename: string) => void;
  downloading: boolean;
}

export function useAuthenticatedQr(standId: string | null): AuthenticatedQr {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<QrStatus>(standId ? "loading" : "idle");
  const [downloading, setDownloading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;

    (async () => {
      if (!standId) {
        setStatus("idle");
        return;
      }

      setStatus("loading");

      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      if (cancelled || generation !== generationRef.current) return;

      if (!session) {
        setStatus("expired");
        return;
      }

      try {
        const blob = await fetchQrBlob(standId, session.access_token);
        if (cancelled || generation !== generationRef.current) return;

        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setObjectUrl(url);
        setStatus("ready");
      } catch (e) {
        if (cancelled || generation !== generationRef.current) return;
        setStatus(e instanceof Error && e.message === "unauthorized" ? "expired" : "error");
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [standId]);

  const reload = useCallback(async () => {
    if (!standId) return;

    const generation = ++generationRef.current;
    setStatus("loading");

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    if (generation !== generationRef.current) return;

    if (!session) {
      setStatus("expired");
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    try {
      const blob = await fetchQrBlob(standId, session.access_token);
      if (generation !== generationRef.current) return;

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setObjectUrl(url);
      setStatus("ready");
    } catch (e) {
      if (generation !== generationRef.current) return;
      setStatus(e instanceof Error && e.message === "unauthorized" ? "expired" : "error");
    }
  }, [standId]);

  const download = useCallback(
    async (filename: string) => {
      if (!standId) return;
      setDownloading(true);

      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      if (!session) {
        setDownloading(false);
        notify.error("Please sign in again", "Your session expired.");
        return;
      }

      try {
        const blob = await fetchQrBlob(standId, session.access_token);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        notify.error("Could not download the code", "Please try again.");
      } finally {
        setDownloading(false);
      }
    },
    [standId],
  );

  return {
    objectUrl,
    status,
    reload: () => void reload(),
    download: (filename: string) => void download(filename),
    downloading,
  };
}
