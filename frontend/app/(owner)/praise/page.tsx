import type { Metadata } from "next";
import { Sparkles, Trophy } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { AppShell } from "@/features/dashboard/app-shell";
import { getPraiseLeaderboard, listPraise, requireOwner } from "@/lib/server/owner-data";
import { relativeDay } from "@/lib/utils/relative-day";

export const metadata: Metadata = {
  title: "Praise — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Staff a customer named, deliberately without the rating.
 *
 * That absence is the whole point of the feature, and it is enforced in the
 * schema rather than by convention: `team_praise_records` has no rating column
 * and the data layer performs no join to `customer_responses`, so the star is
 * not available to leak even by accident.
 *
 * An owner deciding whether to recognise someone should be reacting to what a
 * customer wrote about them — not to a number that may have been about the wait,
 * the parking, or the weather.
 */
export default async function PraisePage() {
  await requireOwner("/praise");

  const [{ items }, leaderboard] = await Promise.all([
    listPraise({ limit: 50 }),
    getPraiseLeaderboard(),
  ]);

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Praise</h1>
      <p className="mb-6 text-base text-muted">Staff your customers named.</p>

      {items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing yet"
          description="When a customer names one of your team, they show up here."
        />
      ) : (
        <>
          {/* Shown only once there is enough to rank. Two names and a trophy
              looks like a toy; it needs to be earned before it means anything. */}
          {leaderboard.length >= 2 && (leaderboard[0]?.count ?? 0) > 1 ? (
            <section className="mb-6 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-control)]">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
                <Trophy className="size-4 text-[color:var(--rb-star)]" aria-hidden="true" />
                Named most often
              </h2>

              <ol className="flex flex-col gap-3">
                {leaderboard.map((entry, index) => (
                  <li key={entry.firstName} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted">
                      {index + 1}
                    </span>
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-text">
                      {entry.firstName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">
                      {entry.firstName}
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-ink">
                      {entry.count}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.praiseId}
                className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-control)]"
              >
                <div className="flex items-center gap-3">
                  {/* The name is the headline. It is the thing the owner is
                      looking for and the only thing they need in order to act. */}
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-semibold text-brand-text">
                    {item.firstName.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold text-ink">{item.firstName}</p>
                    <time dateTime={item.createdAt} className="text-sm text-muted">
                      {relativeDay(item.createdAt)}
                    </time>
                  </div>
                </div>

                {item.note ? (
                  <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-ink">
                    “{item.note}”
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  );
}
