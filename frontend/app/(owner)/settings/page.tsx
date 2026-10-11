import type { Metadata } from "next";
import { CreditCard, Eye, ImageUp, LifeBuoy, Palette, Shield, Trash2 } from "lucide-react";
import { Fragment } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { ProfileCard } from "@/features/dashboard/profile-card";
import { SettingGroup, SettingRow } from "@/components/ui/setting-list";
import { AppShell } from "@/features/dashboard/app-shell";
import { GoogleLinkCare } from "@/features/dashboard/google-link-care";
import { EditableRow } from "@/features/dashboard/settings-form";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { AddLocationButton } from "@/features/settings/add-location-button";
import { ThemeControl } from "@/features/settings/theme-control";
import { ownerOrAdmin, permissionsFor } from "@/lib/owner/permissions";
import { getEntitlementSnapshot } from "@/lib/server/entitlements-service";
import { listLocations, requireOwner } from "@/lib/server/owner-data";
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
 * ONE CARD PER GROUP
 * ------------------
 * The rows are grouped rather than stacked: a quiet caption names the group and
 * its rows share a single card, divided by hairlines. See `setting-list.tsx`
 * for why — in short, six separate bordered cards read as six unrelated things,
 * and this screen is the one where that cost is highest because almost every
 * row here is a door rather than a value.
 *
 * EVERY PLACE, NAMED
 * -----------------
 * Growth and Pro allow more than one location, each with its own name and its
 * own Google link. Every place is listed and each edit names its location —
 * this screen used to edit whichever location was created first, which on a
 * two-location business silently changed the wrong one. With several, each
 * place gets its own group titled with its name, so there is never a question
 * about which building a Google link belongs to.
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
  const [locations, entitlements] = await Promise.all([
    listLocations(organization.orgId),
    getEntitlementSnapshot({ userId: user.id, db: supabase }, organization.orgId),
  ]);
  const can = permissionsFor(organization.role);
  const readOnly = !can.editSettings;
  const several = locations.length > 1;

  return (
    <AppShell businessName={organization.name}>
      <PageHeader title="Settings" />

      <ProfileCard businessName={organization.name} email={user.email ?? null} />

      <SettingGroup label="Business">
        <EditableRow
          inset
          field="businessName"
          label="Business"
          value={organization.name}
          placeholder="The Corner Cafe"
          readOnly={readOnly}
        />
      </SettingGroup>

      {readOnly ? (
        <p className="-mt-4 mb-7 px-1 text-sm text-muted">
          {ownerOrAdmin("change these settings")}
        </p>
      ) : null}

      {locations.map((location) => (
        <SettingGroup
          key={location.locationId}
          label={several ? location.name || "Place" : "Place"}
        >
          <Fragment>
            <EditableRow
              inset
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
              inset
              value={location.destination?.url ?? null}
              locationId={location.locationId}
              readOnly={readOnly}
            />
          </Fragment>
        </SettingGroup>
      ))}

      {can.editSettings && entitlements.canCreateLocation ? (
        <div className="-mt-4 mb-7">
          <AddLocationButton />
        </div>
      ) : can.editSettings && locations.length > 0 ? (
        <p className="-mt-4 mb-7 px-1 text-sm text-muted">
          Your plan includes {entitlements.locationLimit}{" "}
          {entitlements.locationLimit === 1 ? "place" : "places"}.
        </p>
      ) : null}

      {/* The Customer Page is reached from here and from Home's setup list —
          not from the bottom bar, which stays the four things an owner does
          every day. Everyone can open it; the editor itself tells a member or
          viewer that only an owner or admin can change it. */}
      <SettingGroup label="Your page">
        <SettingRow
          href="/customer-page"
          icon={ImageUp}
          title="Your photo"
          description="What customers see when they scan a Tag."
        />
      </SettingGroup>

      <SettingGroup label="Plan">
        <SettingRow
          href="/settings/billing"
          icon={CreditCard}
          title="Billing"
          description="Your plan, messages left, and payment."
        />
      </SettingGroup>

      <SettingGroup label="Appearance">
        <SettingRow
          icon={Palette}
          title="Theme"
          description="System follows this device. Your choice is kept on this device only."
          trailing={<ThemeControl />}
        />
      </SettingGroup>

      {/* A real person to contact, and a plain answer about customer data. A
          barber deciding whether to put our code on their counter wants to know
          who is behind it — a faceless product is one they will not recommend to
          the shop next door. */}
      <SettingGroup label="Help">
        <SettingRow
          href="mailto:help@reviewboost.fit"
          icon={LifeBuoy}
          title="Ask us anything"
          description="Questions about Tags, billing or your Google link."
        />
        {/* Seeing exactly what a customer sees is the single thing that makes an
            owner comfortable putting this on their counter. */}
        <SettingRow
          href="/stands"
          icon={Eye}
          title="See what customers see"
          description="Scan your own code to try it."
        />
        <SettingRow
          href="/privacy"
          icon={Shield}
          title="Privacy policy"
          description="What we collect and how to delete your account."
        />
      </SettingGroup>

      {/* Goes to the deletion screen, which does the deletion. It used to
          open a mail client: a person had to ask us and then wait to be
          believed, and an app that creates accounts has to let someone close
          one from inside it. /delete-account stays for anyone already locked
          out, and for the store listings that need a public URL. */}
      {can.deleteBusiness ? (
        <SettingGroup label="Account">
          <SettingRow
            href="/settings/delete"
            icon={Trash2}
            tone="danger"
            title="Delete account"
            // No timeframe. "within 30 days" was a retention commitment nobody
            // had agreed to operationally, and a deletion promise is the worst
            // place to be approximately right.
            description="Removes your account, your Tags and your ratings. Cancelling is the way to stop billing without losing anything."
          />
        </SettingGroup>
      ) : null}

      <SignOutButton />
    </AppShell>
  );
}
