import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
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
  title: "Team",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Staff a customer named, deliberately without the rating.
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
    <OwnerShell businessName={organization.name}>
      <PageHeader title="Team" description="Staff your customers named." />

      {everything.items.length === 0 ? (
        <EmptyState
          title="No names yet"
          description="When a customer names one of your team, they show up here so you can tell them."
        />
      ) : (
        <div className="flex flex-col gap-12">
          {unmatched.items.length > 0 ? (
            <section>
              <h2 className="mb-4 text-sm font-medium text-muted">
                {unmatched.items.length === 1
                  ? "1 needs a name"
                  : `${unmatched.items.length} need a name`}
              </h2>

              <ul className="divide-y divide-border border-y border-border">
                {unmatched.items.map((item) => (
                  <li key={item.praiseId} className="py-5">
                    <PraiseCard item={item} staff={staff} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {tally.length > 0 ? (
            <section>
              <h2 className="mb-4 text-sm font-medium text-muted">Named this month</h2>
              <ol className="divide-y divide-border border-y border-border">
                {tally.map((member) => (
                  <li key={member.staffId} className="flex min-h-14 items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-ink">
                        {member.name}
                      </span>
                      {member.unshared > 0 ? (
                        <span className="block text-sm text-muted">
                          {member.unshared} not passed on yet
                        </span>
                      ) : member.roleLabel ? (
                        <span className="block truncate text-sm text-muted">{member.roleLabel}</span>
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
              <h2 className="mb-4 text-sm font-medium text-muted">
                {totalShared > 0 ? `${totalShared} passed on` : "Matched"}
              </h2>
              <ul className="divide-y divide-border border-y border-border">
                {handled.map((item) => (
                  <li key={item.praiseId} className="py-5">
                    <PraiseCard item={item} staff={staff} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </OwnerShell>
  );
}

function PraiseCard({
  item,
  staff,
}: {
  item: Awaited<ReturnType<typeof listPraise>>["items"][number];
  staff: Awaited<ReturnType<typeof listStaff>>;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-lg font-semibold text-ink">{item.firstName}</p>
        <time dateTime={item.createdAt} className="shrink-0 text-sm text-muted">
          {relativeDay(item.createdAt)}
        </time>
      </div>

      {item.note ? (
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-ink">
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
