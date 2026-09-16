import type { Metadata } from "next";
import { Eye, LifeBuoy, Mail, Shield, Trash2 } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/features/dashboard/app-shell";
import { GoogleLinkCare } from "@/features/dashboard/google-link-care";
import { EditableRow, GoogleLinkHelp } from "@/features/dashboard/settings-form";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { getPrimaryLocation, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Settings.
 *
 * Editable now, where it was read-only before. That mattered most for the Google
 * link: paste it wrong during setup and every printed code in the building leads
 * nowhere, with no way to fix it from inside the app. A business that cannot
 * correct its own address is a business that leaves.
 *
 * Each row reads as plain text until asked to change — see `settings-form.tsx`
 * for why a wall of live inputs is the wrong shape for this audience.
 *
 * Time zone is deliberately absent. It decides when "today" starts, it was set
 * correctly at signup from the browser, and exposing it invites someone to
 * change it by accident and then wonder why their daily counts moved. It belongs
 * behind support, not on the main screen.
 */
export default async function SettingsPage() {
  const { user, organization } = await requireOwner("/settings");
  const location = await getPrimaryLocation(organization.orgId);

  return (
    <AppShell businessName={organization.name}>
      <h1 className="mb-6 text-2xl font-semibold tracking-[-0.02em] text-ink">Settings</h1>

      <section className="mb-6 flex flex-col gap-3">
        <EditableRow
          field="businessName"
          label="Business"
          value={organization.name}
          placeholder="The Corner Cafe"
        />

        <EditableRow
          field="locationName"
          label="Place"
          value={location?.name ?? null}
          placeholder="High Street"
          {...(location ? { context: { locationId: location.locationId } } : {})}
        />

        <div>
          {/* The Google link gets its own care UX — paste, Test, Open, Save —
              because this is the one field whose silent mistake sends every
              customer from every Tag to the wrong page. Changing it takes
              effect on the next scan; printed codes and NFC tags are untouched. */}
          <GoogleLinkCare value={location?.destination?.url ?? null} />
          <GoogleLinkHelp />
        </div>

        {/* Not editable. Changing the sign-in address is an account-recovery
            operation, not a setting — done carelessly it locks someone out of
            their own business with no way back in. */}
        <div className="flex items-start gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
            <Mail className="size-5 text-muted" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted">Signed in as</p>
            <p className="break-words text-base font-medium text-ink">{user.email ?? "—"}</p>
          </div>
        </div>
      </section>

      {/* A real person to contact, and a plain answer about customer data. A
          barber deciding whether to put our code on their counter wants to know
          who is behind it — a faceless product is one they will not recommend to
          the shop next door. */}
      <section className="mb-6 flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Help</h2>

        <a
          href="mailto:help@reviewboost.app"
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft">
            <LifeBuoy className="size-5 text-brand-text" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-ink">Ask us anything</p>
            <p className="text-sm text-muted">We answer every message.</p>
          </div>
        </a>

        {/* Seeing exactly what a customer sees is the single thing that makes an
            owner comfortable putting this on their counter. */}
        <Link
          href="/stands"
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
            <Eye className="size-5 text-muted" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-ink">See what customers see</p>
            <p className="text-sm text-muted">Scan your own code to try it.</p>
          </div>
        </Link>

        <Link
          href="/privacy"
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
            <Shield className="size-5 text-muted" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-ink">Privacy policy</p>
            <p className="text-sm text-muted">What we collect and how to delete your account.</p>
          </div>
        </Link>
      </section>

      <section className="mb-6 flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Account</h2>

        <a
          href="mailto:privacy@reviewboost.app?subject=Delete%20my%20account&body=Please%20delete%20my%20ReviewBoost%20account%20and%20all%20associated%20data."
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
            <Trash2 className="size-5 text-muted" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-ink">Delete account</p>
            <p className="text-sm text-muted">
              Permanently removes your account and all customer data within 30 days.
            </p>
          </div>
        </a>
      </section>

      <SignOutButton />
    </AppShell>
  );
}
