"use client";

import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { RetryNotice } from "@/components/ui/retry-notice";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";

/**
 * The Tag's page, marked as the owner's preview (`?preview=1`): it looks
 * exactly as customers see it, but opening it is not a tap and a star there
 * is not a rating.
 */
function previewUrl(standUrl: string): string {
  const url = new URL(standUrl);
  url.searchParams.set("preview", "1");
  return url.toString();
}

/** Resolve the owner's link before the click, so a normal link opens on mobile. */
export function PreviewCustomerPage({
  standId,
  variant = "link",
  closed = false,
}: {
  standId: string;
  variant?: "link" | "button";
  /**
   * The business has no plan, so the Tag is off. The preview opens what a
   * customer gets, the closed-link screen, which reads as broken unless the
   * owner is told first. A blind tester thought something had failed.
   */
  closed?: boolean;
}) {
  const [result, setResult] = useState<{
    standId: string;
    url?: string;
    error?: string;
    /** The session ran out: trying again on its own would not help. */
    expired?: boolean;
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
          setResult({ standId, url: previewUrl(data.standUrl) });
      } catch (caught) {
        if (!controller.signal.aborted)
          setResult({
            standId,
            error:
              caught instanceof SessionExpiredError
                ? caught.message
                : "Could not load the customer page link. Try again.",
            expired: caught instanceof SessionExpiredError,
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
      ) : error && !result?.expired ? (
        <PreviewLinkFailed
          standId={standId}
          onRetry={() => {
            setResult(null);
            setAttempt((value) => value + 1);
          }}
        />
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
      {closed ? (
        <p className="mt-2 max-w-[28rem] text-sm leading-relaxed text-muted" data-preview-closed>
          While your Tags are off, this opens what customers see now: “This
          review link isn’t active.”
        </p>
      ) : null}
    </div>
  );
}

/**
 * The link could not be prepared. It tries again by itself (3 s, 10 s, 30 s,
 * or when the connection is back), so the owner never has to keep tapping.
 */
function PreviewLinkFailed({
  standId,
  onRetry,
}: {
  standId: string;
  onRetry: () => void;
}) {
  const retry = useAutoRetry({ key: `preview:${standId}`, failure: null, onRetry });
  return (
    <RetryNotice retry={retry} what="The customer page link didn’t load." />
  );
}
