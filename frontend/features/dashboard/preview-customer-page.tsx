"use client";

import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";

/** Resolve the owner's link before the click, so a normal link opens on mobile. */
export function PreviewCustomerPage({
  standId,
  variant = "link",
}: {
  standId: string;
  variant?: "link" | "button";
}) {
  const [result, setResult] = useState<{
    standId: string;
    url?: string;
    error?: string;
  } | null>(null);
  const url = result?.standId === standId ? result.url : null;
  const error = result?.standId === standId ? result.error : null;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await ownerFetch(
          `/api/v1/review-stands/${standId}/qr?format=json`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("preview_failed");
        const { data } = (await response.json()) as {
          data?: { standUrl?: string };
        };
        if (!data?.standUrl) throw new Error("preview_missing");
        if (!controller.signal.aborted)
          setResult({ standId, url: data.standUrl });
      } catch (caught) {
        if (!controller.signal.aborted)
          setResult({
            standId,
            error:
              caught instanceof SessionExpiredError
                ? caught.message
                : "Could not load the customer page link. Try again.",
          });
      }
    })();
    return () => controller.abort();
  }, [standId, attempt]);

  const linkClass =
    variant === "button"
      ? buttonVariants({ variant: "secondary", size: "lg" })
      : "inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]";
  return (
    <div className="mt-3">
      {url ? (
        <a
          className={linkClass}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Preview customer page{" "}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : error ? (
        <>
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          <button
            type="button"
            className={linkClass}
            onClick={() => {
              setResult(null);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </>
      ) : (
        <p role="status" className="text-sm text-muted">
          Preparing preview…
        </p>
      )}
    </div>
  );
}
