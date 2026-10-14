"use client";

import { Check, FileSpreadsheet, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { stateLabel } from "@/features/connections/connection-words";
import { cn } from "@/lib/utils/cn";

export interface DirectoryProvider {
  id: string;
  displayName: string;
  monogram: string;
  /** The company's official logo file, when one has been added. */
  logoSrc: string | null;
  categories: readonly string[];
  summary: string;
  availability: "available" | "in_setup" | "planned";
  connectionState: string | null;
}

interface ConnectionsDirectoryProps {
  providers: readonly DirectoryProvider[];
  categoryLabels: Record<string, string>;
}

const TONE: Record<string, string> = {
  good: "bg-brand-soft text-brand-text",
  info: "bg-quiet text-muted",
  warn: "bg-[color:var(--rb-danger-soft)] text-danger",
  bad: "bg-[color:var(--rb-danger-soft)] text-danger",
};

/**
 * The Connections directory. Connected apps first, then the ones that can be
 * connected, then what is coming. A card only ever offers what works here:
 * "Coming soon" and "Planned" cards open a description, never a sign-in.
 */
export function ConnectionsDirectory({ providers, categoryLabels }: ConnectionsDirectoryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers.filter(
      (provider) =>
        (!category || provider.categories.includes(category)) &&
        (!q || provider.displayName.toLowerCase().includes(q) || provider.summary.toLowerCase().includes(q)),
    );
  }, [providers, query, category]);

  const groups: Array<{ title: string; items: DirectoryProvider[] }> = [
    { title: "Connected", items: filtered.filter((p) => p.connectionState) },
    { title: "Available", items: filtered.filter((p) => !p.connectionState && p.availability === "available") },
    { title: "Coming soon", items: filtered.filter((p) => !p.connectionState && p.availability === "in_setup") },
    { title: "Planned", items: filtered.filter((p) => !p.connectionState && p.availability === "planned") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <label className="relative block">
          <span className="sr-only">Search apps</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps"
            className="min-h-12 w-full rounded-[var(--radius-control)] border border-border bg-surface pl-12 pr-4 text-base text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
          {[null, ...Object.keys(categoryLabels)].map((key) => (
            <button
              key={key ?? "all"}
              type="button"
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
              className={cn(
                "min-h-10 rounded-full border px-4 text-sm font-medium transition-colors",
                category === key ? "border-brand bg-brand-soft text-brand-text" : "border-border bg-surface text-ink hover:bg-quiet",
              )}
            >
              {key ? categoryLabels[key] : "All"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? <p className="text-base text-muted">No apps match that search.</p> : null}

      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <section key={group.title} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{group.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.items.map((provider) => {
                const status = provider.connectionState ? stateLabel(provider.connectionState, provider.displayName) : null;
                const connected = status?.tone === "good";
                const soon =
                  !status && provider.availability !== "available"
                    ? provider.availability === "in_setup"
                      ? "Soon"
                      : "Planned"
                    : null;
                return (
                  <Link
                    key={provider.id}
                    href={`/settings/connections/${provider.id}`}
                    aria-label={`${provider.displayName}. ${status?.label ?? soon ?? "Add"}`}
                    className="group flex items-start gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-[color:var(--rb-border-strong)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-border bg-surface text-sm font-semibold text-ink" aria-hidden="true">
                      {provider.logoSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a small local brand file
                        <img src={provider.logoSrc} alt="" className="size-[60%] object-contain" />
                      ) : provider.id === "google_sheets" ? (
                        <FileSpreadsheet className="size-5" />
                      ) : (
                        provider.monogram
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-ink">{provider.displayName}</p>
                      <p className="mt-0.5 text-sm text-muted">{provider.summary}</p>
                      {status && !connected ? (
                        <span className={cn("mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[status.tone])}>{status.label}</span>
                      ) : null}
                    </div>
                    {connected ? (
                      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-brand-soft text-brand-text" aria-hidden="true">
                        <Check className="size-4" strokeWidth={2.5} />
                      </span>
                    ) : soon ? (
                      <span className="shrink-0 rounded-[6px] bg-quiet px-2 py-1 text-xs font-medium text-muted" aria-hidden="true">{soon}</span>
                    ) : !status ? (
                      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-border text-ink transition-colors group-hover:bg-quiet" aria-hidden="true">
                        <Plus className="size-4" />
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
