import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { DeleteAccountFlow } from "@/features/settings/delete-account-flow";
import { requireOwner } from "@/lib/server/owner-data";

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

  return (
    <AppShell businessName={organization.name}>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
        Delete {organization.name}
      </h1>
      <p className="mb-6 text-base leading-relaxed text-muted">
        This removes the business, its Tags and everything your customers left.
      </p>

      <DeleteAccountFlow
        businessName={organization.name}
        isOwner={organization.role === "owner"}
      />
    </AppShell>
  );
}
