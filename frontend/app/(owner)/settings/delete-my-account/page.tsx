import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/features/auth/auth-frame";
import { PersonalDeletionFlow } from "@/features/settings/personal-deletion-flow";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Delete my account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Deleting your own login, for anyone signed in (launch gap L1).
 *
 * Deliberately not behind `requireOwner`: that gate sends someone with no
 * business to onboarding, and a person who wants to leave should not have to
 * create a business to find the way out. The frame is the sign-in frame for
 * the same reason, since there may be no business shell to show.
 */
export default async function DeleteMyAccountPage() {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/settings/delete-my-account")}`);

  return (
    <AuthFrame align="start">
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
        Delete my account
      </h1>
      <p className="mb-6 text-base leading-relaxed text-muted">
        This deletes your own sign-in. It doesn&rsquo;t delete any business.
      </p>
      <PersonalDeletionFlow />
    </AuthFrame>
  );
}
