"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { notify } from "@/components/ui/toast";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";

async function fetchQrBlob(
  standId: string,
  organizationId?: string,
): Promise<Blob> {
  const res = await ownerFetch(`/api/v1/review-stands/${standId}/qr`, {
    headers: organizationId ? { "X-Organization-Id": organizationId } : {},
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

export function useAuthenticatedQr(
  standId: string | null,
  organizationId?: string,
): AuthenticatedQr {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<QrStatus>(standId ? "loading" : "idle");
  const [downloading, setDownloading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    const generation = ++generationRef.current;

    (async () => {
      if (!standId) {
        setStatus("idle");
        return;
      }

      setStatus("loading");

      try {
        const blob = await fetchQrBlob(standId, organizationId);
        if (cancelled || generation !== generationRef.current) return;

        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setObjectUrl(url);
        setStatus("ready");
      } catch (e) {
        if (cancelled || generation !== generationRef.current) return;
        setStatus(
          e instanceof SessionExpiredError ||
            (e instanceof Error && e.message === "unauthorized")
            ? "expired"
            : "error",
        );
      }
    })();

    return () => {
      cancelled = true;
      alive.current = false;
      generationRef.current += 1;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [standId, organizationId]);

  const reload = useCallback(async () => {
    if (!standId) return;

    const generation = ++generationRef.current;
    setStatus("loading");

    try {
      const blob = await fetchQrBlob(standId, organizationId);
      if (!alive.current || generation !== generationRef.current) return;

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setObjectUrl(url);
      setStatus("ready");
    } catch (e) {
      if (!alive.current || generation !== generationRef.current) return;
      setStatus(
        e instanceof SessionExpiredError ||
          (e instanceof Error && e.message === "unauthorized")
          ? "expired"
          : "error",
      );
    }
  }, [standId, organizationId]);

  const download = useCallback(
    async (filename: string) => {
      if (!standId) return;
      setDownloading(true);

      try {
        const blob = await fetchQrBlob(standId, organizationId);
        if (!alive.current) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        notify.error("Could not download the code", "Please try again.");
      } finally {
        if (alive.current) setDownloading(false);
      }
    },
    [standId, organizationId],
  );

  return {
    objectUrl,
    status,
    reload: () => void reload(),
    download: (filename: string) => void download(filename),
    downloading,
  };
}
