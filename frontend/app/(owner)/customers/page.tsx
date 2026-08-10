import type { Metadata } from "next";
import { ExternalLink, MessageSquare, Shield, Sparkles, Users } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Stars } from "@/components/ui/stars";
import { AppShell } from "@/features/dashboard/app-shell";
import { getVisitSummary, listVisits, requireOwner } from "@/lib/server/owner-data";
import { relativeDay } from "@/lib/utils/relative-day";

export const metadata: Metadata = {
  title: "Customers — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * What happened on each visit.
 *
 * THE HONEST VERSION OF A "CUSTOMERS" SCREEN
 * ------------------------------------------
 * Competitors put contact lists here. We cannot, and should not want to: the
 * public flow asks for no name, no phone number and no email, so there is no way
 * to know that two visits were the same person. Building a profile view would
 * mean inventing identities we do not have.
 *
 * What the data honestly supports is a record of *visits* — the rating, whether
 * they wrote something, whether they went on to Google, whether they thanked a
 * member of staff. That is genuinely useful: it shows an owner how many people
 * are engaging and how far they get.
 *
 * The privacy note at the bottom is not filler. An owner who expected names will
 * otherwise assume the product is broken, and the real answer — we deliberately
 * never collect them — is a reason to trust us rather than an apology.
 *
 * The summary counts are never broken down by star rating. Split that way they
 * would become an intercept rate, which is precisely the metric this product
 * refuses to produce.
 */
export default async function CustomersPage() {
  await requireOwner("/customers");

  const [summary, page] = await Promise.all([getVisitSummary(), listVisits({ limit: 50 })]);

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Customers</h1>
      <p className="mb-6 text-base text-muted">Everyone who used your code.</p>

      {summary.visits === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody yet"
          description="Every customer who scans your code shows up here, so you can see how many are using it."
        />
      ) : (
        <>
          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric value={summary.visits} label="Scanned" icon={Users} />
            <Metric value={summary.wroteNote} label="Wrote to you" icon={MessageSquare} />
            <Metric value={summary.wentToGoogle} label="Went to Google" icon={ExternalLink} />
            <Metric value={summary.thankedStaff} label="Named staff" icon={Sparkles} />
          </section>

          <ul className="flex flex-col gap-2">
            {page.items.map((visit) => (
              <li
                key={visit.responseId}
                className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-control)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <Stars rating={visit.rating} />
                  <time dateTime={visit.submittedAt} className="shrink-0 text-sm text-muted">
                    {relativeDay(visit.submittedAt)}
                  </time>
                </div>

                {/* Tags rather than sentences: this is a scannable row, and an
                    owner is comparing across it, not reading it. */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {visit.leftNote ? <Tag icon={MessageSquare}>Wrote a message</Tag> : null}
                  {visit.clickedGoogle ? <Tag icon={ExternalLink}>Went to Google</Tag> : null}
                  {visit.praisedSomeone ? <Tag icon={Sparkles}>Named someone</Tag> : null}
                  {!visit.leftNote && !visit.clickedGoogle && !visit.praisedSomeone ? (
                    <span className="text-sm text-muted">Rated and left</span>
                  ) : null}
                  {visit.standLabel ? (
                    <span className="ml-auto shrink-0 text-sm text-muted">{visit.standLabel}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
              <Shield className="size-5 text-muted" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-medium text-ink">No names, on purpose</p>
              <p className="text-sm leading-relaxed text-muted">
                We never ask your customers for a name, phone number, or email. That is why they
                answer honestly — and why nobody can be identified here.
              </p>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function Metric({
  value,
  label,
  icon: Icon,
}: {
  value: number;
  label: string;
  icon: typeof Users;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-control)]">
      <Icon className="mb-2 size-5 text-muted" aria-hidden="true" />
      <p className="text-[1.75rem] font-semibold leading-none tabular-nums tracking-[-0.03em] text-ink">
        {value}
      </p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

function Tag({ icon: Icon, children }: { icon: typeof Users; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-quiet px-2.5 py-1 text-sm text-muted">
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}
