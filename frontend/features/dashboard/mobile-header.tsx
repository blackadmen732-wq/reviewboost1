"use client";

import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";

export function MobileHeader({ businessName }: { businessName?: string | undefined }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
      <Link
        href="/home"
        aria-label="ReviewBoost home"
        className="rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
      >
        <Wordmark size="sm" />
      </Link>

      <Link
        href="/settings"
        aria-label="Settings"
        className="grid size-10 place-items-center rounded-full transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
      >
        <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
          {(businessName ?? "R").slice(0, 1).toUpperCase()}
        </span>
      </Link>
    </header>
  );
}
