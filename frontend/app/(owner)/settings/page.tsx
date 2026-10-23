import type { Metadata } from "next";
import {
  ChevronRight,
  CreditCard,
  Eye,
  ImageUp,
  LifeBuoy,
  Mail,
  Plug,
  Shield,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { GOOGLE_LINK_BLAST } from "@/features/dashboard/google-link-copy";
import { GoogleLinkCare } from "@/features/dashboard/google-link-care";
import { EditableRow, GoogleLinkHelp } from "@/features/dashboard/settings-form";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { AddLocationButton } from "@/features/settings/add-location-button";
import { ThemeControl } from "@/features/settings/theme-control";
import { ownerOrAdmin, permissionsFor } from "@/lib/owner/permissions";
import { getEntitlementSnapshot } from "@/lib/server/entitlements-service";
import {
  getUnreadCount,
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
  const [locations, entitlements, organizations, unread] = await Promise.all([
    listLocations(organization.orgId),
    getEntitlementSnapshot(
      { userId: user.id, db: supabase },
      organization.orgId,
    ),
    listUserOrganizations(),
    getUnreadCount(organization.orgId),
  ]);
  const can = permissionsFor(organization.role);
  const readOnly = !can.editSettings;
  const several = locations.length > 1;

  const ownerOrAdminRole = organization.role === "owner" || organization.role === "admin";

  return (
    <OwnerShell unreadCount={unread} businessName={organization.name}>
      <PageHeader title="Settings" />

      <div className="flex max-w-[40rem] flex-col gap-10">
        <Section title="Business">
          <EditableRow
            field="businessName"
            label="Name"
            value={organization.name}
            placeholder="The Corner Cafe"
            readOnly={readOnly}
          />
          {readOnly ? (
            <p className="text-sm text-muted">{ownerOrAdmin("change these settings")}</p>
          ) : null}
          {organizations.length > 1 ? (
            <Link
              href="/select-org"
              className="inline-flex min-h-11 items-center self-start text-sm font-medium text-ink underline underline-offset-4 hover:no-underline"
            >
              Switch business
            </Link>
          ) : null}
        </Section>

        <Section title={several ? "Places" : "Place"}>
          {locations.map((location, index) => (
            <div
              key={location.locationId}
              className={
                several && index > 0
                  ? "flex flex-col gap-3 border-t border-border pt-6"
                  : "flex flex-col gap-3"
              }
              data-location-id={location.locationId}
            >
              <EditableRow
                field="locationName"
                label={several ? "Place name" : "Name"}
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

          {/* Said once for every place, not repeated under each one. */}
          <div>
            <p className="max-w-[46ch] text-sm leading-relaxed text-muted">{GOOGLE_LINK_BLAST}</p>
            <GoogleLinkHelp />
          </div>

          {can.editSettings && entitlements.canCreateLocation ? (
            <AddLocationButton />
          ) : can.editSettings && locations.length > 0 ? (
            <p className="text-sm text-muted">
              Your plan includes {entitlements.locationLimit}{" "}
              {entitlements.locationLimit === 1 ? "place" : "places"}.
            </p>
          ) : null}
        </Section>

        {/* The Customer Page is reached from here, Set up and Home's setup list
            — not from the bottom bar, which stays the four things an owner does
            every day. Connections is owners and admins only: connecting an app
            reads customer data. */}
        <Section title="Your page, apps and plan">
          <RowList>
            <Row href="/customer-page" icon={ImageUp} title="Customer page" detail="Your photo, and what customers see when they scan a Tag." />
            {ownerOrAdminRole ? (
              <Row href="/settings/connections" icon={Plug} title="Connections" detail="Bring in customers from the apps you already use." />
            ) : null}
            <Row href="/settings/billing" icon={CreditCard} title="Billing" detail="Your plan, texts left, and payment." />
          </RowList>
        </Section>

        <Section title="Appearance">
          <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-base font-medium text-ink">Theme</p>
              <p className="text-sm text-muted">
                System follows this device. Your choice is kept on this device only.
              </p>
            </div>
            <ThemeControl />
          </div>
        </Section>

        {/* A real person to contact, and a plain answer about customer data. A
            barber deciding whether to put our code on their counter wants to
            know who is behind it. Seeing exactly what a customer sees is what
            makes an owner comfortable putting the Tag out at all. */}
        <Section title="Help">
          <RowList>
            <Row href="mailto:help@reviewboost.fit" icon={LifeBuoy} title="Ask us anything" detail="Questions about Tags, billing or your Google link." external />
            <Row href="/stands" icon={Eye} title="See what customers see" detail="Scan your own code to try it." />
            <Row href="/privacy" icon={Shield} title="Privacy policy" detail="What we collect and how to delete your account." />
          </RowList>
        </Section>

        <Section title="Account">
          {/* Not editable. Changing the sign-in address is an account-recovery
              operation, not a setting — done carelessly it locks someone out of
              their own business with no way back in. */}
          <div className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
              <Mail className="size-5 text-muted" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-muted">Signed in as</p>
              <p className="break-words text-base font-medium text-ink">{user.email ?? "—"}</p>
            </div>
          </div>
          <SignOutButton />
          {/* The deletion screen does the deletion; an app that creates
              accounts lets someone close one from inside it. Everyone gets the
              way out: only an owner can delete the business, and anyone else
              is taken to deleting their own sign-in. No timeframe is promised:
              a deletion promise is the worst place to be approximately right. */}
          <RowList>
            {can.deleteBusiness ? (
              <Row href="/settings/delete" icon={Trash2} title="Delete this business" detail="Removes the business, its Tags and ratings. Cancelling is the way to stop billing without losing anything." danger />
            ) : (
              <Row href="/settings/delete-my-account" icon={Trash2} title="Delete my account" detail={`Removes your sign-in. ${organization.name} and its ratings stay.`} danger />
            )}
          </RowList>
        </Section>
      </div>
    </OwnerShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-base font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Related links as one list, the way a phone's own Settings groups them: one
 * outline, rows divided by hairlines, a chevron on each. Seven separate cards
 * under seven headings made a two-place business scroll for three screens.
 */
function RowList({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      {children}
    </ul>
  );
}

function Row({
  href,
  icon: Icon,
  title,
  detail,
  external = false,
  danger = false,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  external?: boolean;
  danger?: boolean;
}) {
  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
        <Icon className={danger ? "size-5 text-danger" : "size-5 text-muted"} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={danger ? "block text-base font-medium text-danger" : "block text-base font-medium text-ink"}>
          {title}
        </span>
        <span className="block text-sm text-muted">{detail}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-[color:var(--rb-border-strong)]" aria-hidden="true" />
    </>
  );
  const className =
    "flex min-h-16 items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[color:var(--rb-focus-soft)]";
  return (
    <li>
      {external ? (
        <a href={href} className={className}>
          {body}
        </a>
      ) : (
        <Link href={href} className={className}>
          {body}
        </Link>
      )}
    </li>
  );
}
