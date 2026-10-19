import { ChevronRight, QrCode } from "lucide-react";
import Link from "next/link";

import {
  lastUsedLabel,
  tagNeedsRewrite,
  tagReadiness,
} from "@/lib/owner/tag-readiness";
import type { Stand } from "@/lib/server/owner-data";
import { cn } from "@/lib/utils/cn";

/**
 * Tags are things on a counter, so each row leads with a small dark tile that
 * stands in for the physical Tag, and says the two things an owner checks on
 * one: does the printed code still work, and is the chip programmed.
 *
 * QR and NFC are shown separately because they fail separately. The single
 * pill this replaces could only say "Both", which nobody could act on.
 */
export function TagsList({ stands }: { stands: Stand[] }) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {stands.map((stand) => {
        const status = tagReadiness(stand);
        const qrOk = status === "ready" || status === "needs-nfc";
        const nfcOk = status === "ready" || status === "needs-qr";
        const nfcLabel = nfcOk
          ? "NFC ready"
          : tagNeedsRewrite(stand)
            ? "Reprogram NFC"
            : "Program NFC";
        return (
          <li key={stand.standId}>
            <Link
              href={`/stands/${stand.standId}`}
              className="group -mx-2 flex min-h-[4.5rem] items-center gap-4 rounded-[var(--radius-control)] px-2 py-3.5 transition-colors duration-150 hover:bg-quiet active:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-ink text-canvas transition-transform duration-150 group-active:scale-95"
              >
                <QrCode className="size-6" strokeWidth={1.75} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-ink">{stand.label}</p>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {stand.locationName ?? "Place"} · {lastUsedLabel(stand.lastOpenedAt)}
                </p>
                <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <Readiness ok={qrOk} label={qrOk ? "QR ready" : "Reprint QR"} />
                  <Readiness ok={nfcOk} label={nfcLabel} />
                </p>
              </div>

              <ChevronRight
                className="size-5 shrink-0 text-[color:var(--rb-border-strong)] transition-transform duration-150 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Readiness({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", ok ? "text-muted" : "font-medium text-ink")}>
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", ok ? "bg-brand" : "bg-star")}
      />
      {label}
    </span>
  );
}
