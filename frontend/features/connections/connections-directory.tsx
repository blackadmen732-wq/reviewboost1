"use client";

import { ArrowUpRight, FileSpreadsheet, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { stateLabel } from "@/features/connections/connection-words";
import { cn } from "@/lib/utils/cn";

export interface DirectoryProvider {
  id: string;
  displayName: string;
  monogram: string;
  /** The company's own site, without a scheme ("squareup.com"). */
  website?: string | null;
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

type Status = { label: string; tone: "good" | "info" | "warn" | "bad" | "soon" };

const PILL: Record<Status["tone"], string> = {
  good: "bg-brand-soft text-brand-text",
  info: "bg-quiet text-muted",
  warn: "bg-[color:var(--rb-warning-soft)] text-[color:var(--rb-warning)]",
  bad: "bg-[color:var(--rb-danger-soft)] text-danger",
  soon: "bg-quiet text-muted",
};

const DOT: Record<Status["tone"], string> = {
  good: "bg-brand",
  info: "bg-[color:var(--rb-border-strong)]",
  warn: "bg-[color:var(--rb-warning)]",
  bad: "bg-danger",
  soon: "bg-[color:var(--rb-border-strong)]",
};

/** Usable first: what is on, then what can be added now, then what is coming. */
function rank(provider: DirectoryProvider): number {
  if (provider.connectionState) return 0;
  if (provider.availability === "available") return 1;
  if (provider.availability === "in_setup") return 2;
  return 3;
}

function statusOf(provider: DirectoryProvider): Status {
  if (provider.connectionState) return stateLabel(provider.connectionState, provider.displayName);
  if (provider.availability === "available") return { label: "Ready", tone: "info" };
  if (provider.availability === "in_setup") return { label: "Coming soon", tone: "soon" };
  return { label: "Planned", tone: "soon" };
}

/** The one thing the card's button does, in owner words. */
function actionOf(provider: DirectoryProvider): string {
  const isList = provider.id === "google_sheets" || provider.id === "csv";
  if (provider.connectionState) return "Manage";
  if (provider.availability !== "available") return "Details";
  if (provider.id === "google_sheets") return "Pick a sheet";
  if (provider.id === "csv") return "Upload a file";
  return isList ? "Add" : "Connect";
}

/**
 * The Connections directory: a grid of apps, filtered by kind or by name.
 *
 * Each card says what the app is, links to the company's own site, and offers
 * one action that works here. A list (a Google Sheet, a CSV file) is read once
 * and keeps no access, so it is "Added", not connected. An app that is not
 * built yet says "Coming soon" or "Planned" and its button only opens the
 * description: no card offers a sign-in that cannot finish.
 *
 * The status sits where a switch would. There is no on/off for a connection,
 * only connect and disconnect on its page, so a switch here would promise
 * something the product does not do.
 */
export function ConnectionsDirectory({ providers, categoryLabels }: ConnectionsDirectoryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  // Only kinds that some app actually has, so no tab ever opens onto nothing.
  const tabs = useMemo(
    () => Object.keys(categoryLabels).filter((key) => providers.some((provider) => provider.categories.includes(key))),
    [providers, categoryLabels],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers
      .filter(
        (provider) =>
          (!category || provider.categories.includes(category)) &&
          (!q ||
            provider.displayName.toLowerCase().includes(q) ||
            provider.summary.toLowerCase().includes(q) ||
            (provider.website ?? "").toLowerCase().includes(q)),
      )
      .map((provider, index) => ({ provider, index }))
      .sort((a, b) => rank(a.provider) - rank(b.provider) || a.index - b.index)
      .map(({ provider }) => provider);
  }, [providers, query, category]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="-mx-5 overflow-x-auto px-5 lg:mx-0 lg:px-0"
          // The tab row scrolls sideways on a phone; the page never does.
        >
          <div
            className="inline-flex min-w-max gap-1 rounded-[var(--radius-control)] border border-border bg-quiet p-1"
            role="group"
            aria-label="Show apps by kind"
          >
            {[null, ...tabs].map((key) => (
              <button
                key={key ?? "all"}
                type="button"
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
                className={cn(
                  "min-h-10 whitespace-nowrap rounded-[calc(var(--radius-control)-4px)] px-4 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                  category === key ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted hover:text-ink",
                )}
              >
                {key ? categoryLabels[key] : "All apps"}
              </button>
            ))}
          </div>
        </div>

        <label className="relative block lg:w-64">
          <span className="sr-only">Search apps</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="min-h-12 w-full rounded-[var(--radius-control)] border border-border bg-surface pl-12 pr-4 text-base text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          />
        </label>
      </div>

      {shown.length === 0 ? <p className="text-base text-muted">No apps match that search.</p> : null}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-connections-grid>
        {shown.map((provider) => {
          const status = statusOf(provider);
          const usable = provider.connectionState !== null || provider.availability === "available";
          return (
            <li
              key={provider.id}
              className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface"
              data-provider={provider.id}
            >
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold leading-tight text-ink">{provider.displayName}</h2>
                    {provider.website ? (
                      <a
                        href={`https://${provider.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        // A 44px target drawn in a 24px line: the negative
                        // margin keeps the card's spacing, the height keeps a
                        // thumb off the button below.
                        className="-mb-2.5 -mt-1.5 inline-flex min-h-11 items-center gap-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
                      >
                        {provider.website}
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">(opens {provider.displayName}&apos;s site)</span>
                      </a>
                    ) : (
                      <p className="mt-1 text-sm text-muted">From your computer</p>
                    )}
                  </div>
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-border bg-surface text-sm font-semibold text-ink"
                    aria-hidden="true"
                  >
                    {provider.logoSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a small local brand file
                      <img src={provider.logoSrc} alt="" className="size-[62%] object-contain" />
                    ) : provider.id === "google_sheets" || provider.id === "csv" ? (
                      <FileSpreadsheet className="size-5" />
                    ) : (
                      provider.monogram
                    )}
                  </span>
                </div>
                <p className="text-base leading-relaxed text-muted">{provider.summary}</p>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
                <Link
                  href={`/settings/connections/${provider.id}`}
                  aria-label={`${actionOf(provider)}: ${provider.displayName}`}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-[var(--radius-control)] border px-4 text-sm font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                    usable
                      ? "border-[color:var(--rb-border-strong)] bg-surface text-ink hover:bg-quiet"
                      : "border-border bg-surface text-muted hover:text-ink",
                  )}
                >
                  {actionOf(provider)}
                </Link>
                <span
                  className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium", PILL[status.tone])}
                  data-connection-status
                >
                  <span className={cn("size-2 rounded-full", DOT[status.tone])} aria-hidden="true" />
                  {status.label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-sm leading-relaxed text-muted">
        Use an app that isn&apos;t here?{" "}
        <Link
          href="/support"
          className="font-medium text-brand-text underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          Tell us which
        </Link>
        , and it moves up the list.
      </p>
    </div>
  );
}
