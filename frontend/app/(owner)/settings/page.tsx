import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
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
 * Settings, the way a first-party app does them: a short list of named
 * groups, each a single surface with hairline rows — never a wall of
 * separate cards.
 *
 * Each editable row reads as plain text until asked to change — see
 * `settings-form.tsx` for why a wall of live inputs is the wrong shape for
 * this audience.
 *
 * Time zone is deliberately absent. It decides when "today" starts, it was
 * set correctly at signup from the browser, and exposing it invites someone
 * to change it by accident and then wonder why their daily counts moved. It
 * belongs behind support, not on the main screen.
 */
export default async function SettingsPage() {
  const { user, organization } = await requireOwner("/settings");
  const location = await getPrimaryLocation(organization.orgId);

  return (
    <AppShell businessName={organization.name}>
      <PageHeader title="Settings" />

      <div className="flex flex-col gap-10">
        <section aria-labelledby="settings-business">
          <GroupLabel id="settings-business">Business</GroupLabel>
          <div className="rb-list">
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
            {/* Not editable. Changing the sign-in address is an
                account-recovery operation, not a setting — done carelessly it
                locks someone out of their own business with no way back in. */}
            <div className="px-5 py-4">
              <p className="text-sm font-medium text-muted">Signed in as</p>
              <p className="mt-0.5 break-words text-base font-medium text-ink">
                {user.email ?? "—"}
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="settings-google">
          <GroupLabel id="settings-google">Google review link</GroupLabel>
          <div className="rb-list">
            {/* The Google link gets its own care UX — paste, Test, Open, Save —
                because this is the one field whose silent mistake sends every
                customer from every Tag to the wrong page. Changing it takes
                effect on the next scan; printed codes and NFC tags are
                untouched. */}
            <GoogleLinkCare value={location?.destination?.url ?? null} />
          </div>
          <div className="mt-2 px-1">
            <GoogleLinkHelp />
          </div>
        </section>

        <section aria-labelledby="settings-customer-page">
          <GroupLabel id="settings-customer-page">Customer page</GroupLabel>
          <div className="rb-list">
            <LinkRow
              href="/customer-page"
              title="Artwork and preview"
              description="The photo and page customers see when they scan."
            />
          </div>
        </section>

        <section aria-labelledby="settings-billing">
          <GroupLabel id="settings-billing">Billing</GroupLabel>
          <div className="rb-list">
            <LinkRow
              href="/settings/billing"
              title="Plan and messages"
              description="Your subscription, and the texts it includes."
            />
          </div>
        </section>

        {/* A real person to contact, and a plain answer about customer data.
            A barber deciding whether to put our code on their counter wants to
            know who is behind it — a faceless product is one they will not
            recommend to the shop next door. */}
        <section aria-labelledby="settings-help">
          <GroupLabel id="settings-help">Help</GroupLabel>
          <div className="rb-list">
            <LinkRow
              href="mailto:help@reviewboost.fit"
              title="Ask us anything"
              description="Questions about Tags, billing or your Google link."
            />
            {/* Seeing exactly what a customer sees is the single thing that
                makes an owner comfortable putting this on their counter. */}
            <LinkRow
              href="/stands"
              title="See what customers see"
              description="Scan your own code to try it."
            />
            <LinkRow
              href="/privacy"
              title="Privacy policy"
              description="What we collect and how to delete your account."
            />
          </div>
        </section>

        <section aria-labelledby="settings-account">
          <GroupLabel id="settings-account">Account</GroupLabel>
          <div className="rb-list">
            {/* Goes to the deletion screen, which does the deletion. It used
                to open a mail client: a person had to ask us and then wait to
                be believed, and an app that creates accounts has to let
                someone close one from inside it. */}
            <LinkRow
              href="/settings/delete"
              title="Delete account"
              description="Removes your account, your Tags and your ratings."
              danger
            />
            <SignOutButton />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function GroupLabel({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="rb-section-label mb-3 px-1">
      {children}
    </h2>
  );
}

function LinkRow({
  href,
  title,
  description,
  danger = false,
}: {
  href: string;
  title: string;
  description: string;
  danger?: boolean;
}) {
  const external = href.startsWith("mailto:");
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <p className={danger ? "text-base font-medium text-danger" : "text-base font-medium text-ink"}>
          {title}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{description}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 self-center text-[color:var(--rb-border-strong)]" aria-hidden="true" />
    </>
  );

  const className =
    "flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-quiet/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[color:var(--rb-focus-soft)]";

  return external ? (
    <a href={href} className={className}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}
