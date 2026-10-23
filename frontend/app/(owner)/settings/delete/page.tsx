import type { Metadata } from "next";

import { OwnerShell } from "@/features/dashboard/owner-shell";
import { DeleteAccountFlow } from "@/features/settings/delete-account-flow";
import { BackLink } from "@/components/ui/back-link";
import { getUnreadCount, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Delete account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The in-app deletion screen.
 *
 * On its own route rather than inside Settings. A destructive action sharing a
 * screen with "change your business name" is one mis-tap from the thing it can
 * never take back, and giving it a page of its own also gives it room to say
 * what it does before asking.
 */
export default async function DeleteAccountSettingsPage() {
  const { organization } = await requireOwner("/settings/delete");
  const unread = await getUnreadCount(organization.orgId);

  return (
    <OwnerShell unreadCount={unread} businessName={organization.name}>
      <BackLink href="/settings">Settings</BackLink>
      {/* Only an owner can delete the business; anyone else is here to leave,
          and was told "Delete Mario's Pizza" above a screen saying they can't. */}
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
        {organization.role === "owner" ? `Delete ${organization.name}` : "Delete your account"}
      </h1>
      <p className="mb-6 text-base leading-relaxed text-muted">
        {organization.role === "owner"
          ? "This removes the business, its Tags and everything your customers left."
          : `${organization.name} and its ratings stay. Only your own sign-in is removed.`}
      </p>

      <DeleteAccountFlow
        businessName={organization.name}
        isOwner={organization.role === "owner"}
      />
    </OwnerShell>
  );
}
