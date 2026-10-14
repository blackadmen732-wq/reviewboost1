import type { Metadata } from "next";
import {
  CreditCard,
  Eye,
  ImageUp,
  LifeBuoy,
  Mail,
  Shield,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/features/dashboard/app-shell";
import { GoogleLinkCare } from "@/features/dashboard/google-link-care";
import { EditableRow } from "@/features/dashboard/settings-form";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { AddLocationButton } from "@/features/settings/add-location-button";
import { ThemeControl } from "@/features/settings/theme-control";
import { ownerOrAdmin, permissionsFor } from "@/lib/owner/permissions";
import { getEntitlementSnapshot } from "@/lib/server/entitlements-service";
import {
  listLocations,
  listUserOrganizations,
  requireOwner,
} from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";

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
 * EVERY PLACE, NAMED
 * -----------------
 * Growth and Pro allow more than one location, each with its own name and its
 * own Google link. Every place is listed and each edit names its location —
 * this screen used to edit whichever location was created first, which on a
 * two-location business silently changed the wrong one.
 *
 * Only an owner or admin can change these (`api/v1/settings` refuses anyone
 * else), so a member or viewer sees the same values with no Change controls.
 *
 * Time zone is deliberately absent. It decides when "today" starts, it was set
 * correctly at signup from the browser, and exposing it invites someone to
 * change it by accident and then wonder why their daily counts moved. It belongs
 * behind support, not on the main screen.
 */
export default async function SettingsPage() {
  const { user, organization } = await requireOwner("/settings");
  const supabase = await supabaseServer();
  const [locations, entitlements, organizations] = await Promise.all([
    listLocations(organization.orgId),
    getEntitlementSnapshot(
      { userId: user.id, db: supabase },
      organization.orgId,
    ),
    listUserOrganizations(),
  ]);
  const can = permissionsFor(organization.role);
  const readOnly = !can.editSettings;
  const several = locations.length > 1;

  return (
    <AppShell businessName={organization.name}>
      <h1 className="mb-6 text-2xl font-semibold tracking-[-0.02em] text-ink">
        Settings
      </h1>

      <section className="mb-6 flex flex-col gap-3">
        <EditableRow
          field="businessName"
          label="Business"
          value={organization.name}
          placeholder="The Corner Cafe"
          readOnly={readOnly}
        />

        {readOnly ? (
          <p className="text-sm text-muted">
            {ownerOrAdmin("change these settings")}
          </p>
        ) : null}
      </section>

      <section
        className="mb-6 flex flex-col gap-3"
        aria-labelledby="places-heading"
      >
        <h2 id="places-heading" className="text-base font-semibold text-ink">
          {several ? "Places" : "Place"}
        </h2>

        {locations.map((location, index) => (
          <div
            key={location.locationId}
            className={
              several && index > 0
                ? "mt-3 flex flex-col gap-3 border-t border-border pt-6"
                : "flex flex-col gap-3"
            }
            data-location-id={location.locationId}
          >
            <EditableRow
              field="locationName"
              label={several ? "Place name" : "Place"}
              value={location.name}
              placeholder="High Street"
              context={{ locationId: location.locationId }}
              readOnly={readOnly}
            />
            {/* The Google link gets its own care UX — paste, Test, Open, Save —
                because this is the one field whose silent mistake sends every
                customer from that place's Tags to the wrong page. Changing it
                takes effect on the next scan; printed codes and NFC tags are
                untouched. */}
            <GoogleLinkCare
              value={location.destination?.url ?? null}
              locationId={location.locationId}
              readOnly={readOnly}
            />
          </div>
        ))}

        {can.editSettings && entitlements.canCreateLocation ? (
          <AddLocationButton />
        ) : can.editSettings && locations.length > 0 ? (
          <p className="text-sm text-muted">
            Your plan includes {entitlements.locationLimit}{" "}
            {entitlements.locationLimit === 1 ? "place" : "places"}.
          </p>
        ) : null}
      </section>

      {/* The Customer Page is reached from here and from Home's setup list —
          not from the bottom bar, which stays the four things an owner does
          every day. Everyone can open it; the editor itself tells a member or
          viewer that only an owner or admin can change it. */}
      <section
        className="mb-6 flex flex-col gap-3"
        aria-labelledby="customer-page-heading"
      >
        <h2
          id="customer-page-heading"
          className="text-base font-semibold text-ink"
        >
          Customer page
        </h2>
        <Link
          href="/customer-page"
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
            <ImageUp className="size-5 text-muted" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-ink">Your photo</p>
            <p className="text-sm text-muted">
              What customers see when they scan a Tag.
            </p>
          </div>
        </Link>
      </section>

      <section className="mb-6 flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">Plan</h2>
        <Link
          href="/settings/billing"
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
            <CreditCard className="size-5 text-muted" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-ink">Billing</p>
            <p className="text-sm text-muted">
              Your plan, messages left, and payment.
            </p>
          </div>
        </Link>
      </section>

      <section
        className="mb-6 flex flex-col gap-3"
        aria-labelledby="appearance-heading"
      >
        <h2
          id="appearance-heading"
          className="text-base font-semibold text-ink"
        >
          Appearance
        </h2>
        <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-medium text-ink">Theme</p>
            <p className="text-sm text-muted">
              System follows this device. Your choice is kept on this device
              only.
            </p>
          </div>
          <ThemeControl />
        </div>
      </section>

      <section className="mb-6 flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">Signed-in account</h2>

        {/* Not editable. Changing the sign-in address is an account-recovery
            operation, not a setting — done carelessly it locks someone out of
            their own business with no way back in. */}
        <div className="flex items-start gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
            <Mail className="size-5 text-muted" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted">Signed in as</p>
            <p className="break-words text-base font-medium text-ink">
              {user.email ?? "—"}
            </p>
          </div>
        </div>
      </section>

      {/* A real person to contact, and a plain answer about customer data. A
          barber deciding whether to put our code on their counter wants to know
          who is behind it — a faceless product is one they will not recommend to
          the shop next door. */}
      <section className="mb-6 flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">Help</h2>

        <a
          href="mailto:help@reviewboost.fit"
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft">
            <LifeBuoy className="size-5 text-brand-text" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-ink">Ask us anything</p>
            <p className="text-sm text-muted">
              Questions about Tags, billing or your Google link.
            </p>
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
            <p className="text-base font-medium text-ink">
              See what customers see
            </p>
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
            <p className="text-sm text-muted">
              What we collect and how to delete your account.
            </p>
          </div>
        </Link>
      </section>

      <section className="mb-6 flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">Account actions</h2>

        {/* Goes to the deletion screen, which does the deletion. It used to
            open a mail client: a person had to ask us and then wait to be
            believed, and an app that creates accounts has to let someone close
            one from inside it. /delete-account stays for anyone already locked
            out, and for the store listings that need a public URL. */}
        {can.deleteBusiness ? (
          <Link
            href="/settings/delete"
            className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
              <Trash2 className="size-5 text-muted" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-ink">
                Delete this business
              </p>
              {/* No timeframe. "within 30 days" was a retention commitment nobody
                  had agreed to operationally, and a deletion promise is the worst
                  place to be approximately right. */}
              <p className="text-sm text-muted">
                Removes this business, its Tags and ratings. Cancelling is the
                way to stop billing without losing anything.
              </p>
            </div>
          </Link>
        ) : null}
      </section>

      {organizations.length > 1 ? (
        <Link
          href="/select-org"
          className="mb-4 inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline underline-offset-4"
        >
          Switch business
        </Link>
      ) : null}
      <SignOutButton />
    </AppShell>
  );
}
