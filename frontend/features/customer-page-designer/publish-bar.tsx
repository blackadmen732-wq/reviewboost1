"use client";

import { Check, CircleAlert, ExternalLink } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { PublishPhase } from "@/features/customer-page-designer/designer-state";

interface PublishBarProps {
  phase: PublishPhase;
  hasUnpublishedChanges: boolean;
  hasEverPublished: boolean;
  canPublish: boolean;
  previewHref: string;
  onPublish: () => void;
}

/**
 * The header, and the only place the customer's copy of the page can change.
 *
 * The status is the honest part. An owner editing this screen is looking at a
 * page nobody else can see yet, and the difference between "what I am looking
 * at" and "what my customers get" is the one thing they can be wrong about — so
 * it is stated in words next to the button that resolves it, in every state,
 * rather than implied by an enabled save button.
 */
export function PublishBar({
  phase,
  hasUnpublishedChanges,
  hasEverPublished,
  canPublish,
  previewHref,
  onPublish,
}: PublishBarProps) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
          Customer Page
        </h1>
        <p className="mt-1 text-base text-muted">
          Make the page customers see when they tap or scan.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Status
          phase={phase}
          hasUnpublishedChanges={hasUnpublishedChanges}
          hasEverPublished={hasEverPublished}
        />

        <Button variant="ghost" size="sm" className="w-auto" asChild>
          <Link href={previewHref} target="_blank" rel="noreferrer">
            Preview as customer
            <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
        </Button>

        {canPublish ? (
          <Button
            size="sm"
            variant="ink"
            className="w-auto"
            disabled={!hasUnpublishedChanges}
            loading={phase === "publishing"}
            loadingLabel="Publishing…"
            onClick={onPublish}
          >
            Publish
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Status({
  phase,
  hasUnpublishedChanges,
  hasEverPublished,
}: Pick<PublishBarProps, "phase" | "hasUnpublishedChanges" | "hasEverPublished">) {
  if (phase === "failed") {
    return (
      <p
        role="alert"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--rb-danger)]"
      >
        <CircleAlert className="size-4" aria-hidden="true" />
        Couldn’t publish. Try again.
      </p>
    );
  }

  if (hasUnpublishedChanges) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--rb-warning)]">
        <CircleAlert className="size-4" aria-hidden="true" />
        Changes not published
      </p>
    );
  }

  if (!hasEverPublished) return null;

  return (
    <p
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--rb-brand-text)]"
      {...(phase === "published" ? { role: "status" } : {})}
    >
      <Check className="size-4" aria-hidden="true" strokeWidth={3} />
      Published
    </p>
  );
}
