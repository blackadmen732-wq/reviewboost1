import type { Metadata } from "next";
import { Sparkles, Trophy } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { AppShell } from "@/features/dashboard/app-shell";
import { PraiseMatcher } from "@/features/dashboard/praise-matcher";
import { PraiseSharedButton } from "@/features/dashboard/praise-shared-button";
import {
  getStaffPraiseTally,
  listPraise,
  listStaff,
  requireOwner,
} from "@/lib/server/owner-data";
import { relativeDay } from "@/lib/utils/relative-day";

export const metadata: Metadata = {
  title: "Praise — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Staff a customer named, deliberately without the rating.
 *
 * That absence is enforced in the schema, not by convention:
 * `team_praise_records` has no rating column, and neither the data layer nor the
 * matching endpoint joins to `customer_responses`. The star is not available to
 * influence who gets recognised — which matters, because a 3 given for a long
 * wait says nothing about the person who was kind at the till.
 *
 * THE SCREEN IS ORDERED BY WHAT NEEDS DOING
 * -----------------------------------------
 * Praise waiting on a name comes first, because it is the only part with a
 * decision in it. The team tally comes next, because it is the reason to care.
 * Everything already handled sits at the bottom, present but quiet.
 *
 * Matching is always a human decision. A customer types a first name from
 * memory, on a phone, after a meal — guessing which colleague was meant would
 * credit the wrong person, and being confidently wrong about that is worse than
 * asking.
 */
export default async function PraisePage() {
  const { organization } = await requireOwner("/praise");

  const [unmatched, everything, staff, tally] = await Promise.all([
    listPraise(organization.orgId, { unmatchedOnly: true, limit: 50 }),
    listPraise(organization.orgId, { limit: 50 }),
    listStaff(organization.orgId),
    getStaffPraiseTally(organization.orgId),
  ]);

  const handled = everything.items.filter((item) => item.status !== "unmatched");
  const totalShared = everything.items.filter((item) => item.isShared).length;

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Praise</h1>
      <p className="mb-6 text-base text-muted">Staff your customers named.</p>

      {everything.items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing yet"
          description="When a customer names one of your team, they show up here so you can tell them."
        />
      ) : (
        <>
          {unmatched.items.length > 0 ? (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                {unmatched.items.length === 1
                  ? "1 needs a name"
                  : `${unmatched.items.length} need a name`}
              </h2>

              <ul className="flex flex-col gap-3">
                {unmatched.items.map((item) => (
                  <li
                    key={item.praiseId}
                    className="rounded-[var(--radius-card)] border border-[color:var(--rb-star)] bg-[color:var(--rb-star)]/8 p-4"
                  >
                    <PraiseCard item={item} staff={staff} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {tally.length > 0 ? (
            <section className="mb-8 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-control)]">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
                <Trophy className="size-4 text-[color:var(--rb-star)]" aria-hidden="true" />
                Your team
              </h2>

              <ol className="flex flex-col gap-3">
                {tally.map((member) => (
                  <li key={member.staffId} className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-text">
                      {member.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-ink">
                        {member.name}
                      </span>
                      {member.unshared > 0 ? (
                        // The nudge that makes the feature do its job: praise
                        // that was matched but never passed on is praise that
                        // achieved nothing.
                        <span className="block text-sm text-[color:var(--rb-warning)]">
                          {member.unshared} not passed on yet
                        </span>
                      ) : member.roleLabel ? (
                        <span className="block truncate text-sm text-muted">
                          {member.roleLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-ink">
                      {member.count}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {handled.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                {totalShared > 0 ? `${totalShared} passed on` : "Matched"}
              </h2>

              <ul className="flex flex-col gap-3">
                {handled.map((item) => (
                  <li
                    key={item.praiseId}
                    className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
                  >
                    <PraiseCard item={item} staff={staff} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </AppShell>
  );
}

/**
 * One piece of praise: what the customer wrote, and the two decisions attached.
 *
 * The customer's words are the largest thing on the card. They are the evidence
 * for both decisions, and they are the part worth reading twice.
 */
function PraiseCard({
  item,
  staff,
}: {
  item: Awaited<ReturnType<typeof listPraise>>["items"][number];
  staff: Awaited<ReturnType<typeof listStaff>>;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PraiseMatcher
          praiseId={item.praiseId}
          typedName={item.firstName}
          staff={staff}
          matchedStaffId={item.matchedStaffId}
          matchedStaffName={item.matchedStaffName}
        />

        {/* Telling someone only becomes an option once there is somebody to
            tell. Showing it before then would be an action that cannot work. */}
        {item.matchedStaffId && item.matchedStaffName ? (
          <PraiseSharedButton
            praiseId={item.praiseId}
            isShared={item.isShared}
            staffName={item.matchedStaffName}
          />
        ) : null}
      </div>
    </>
  );
}
