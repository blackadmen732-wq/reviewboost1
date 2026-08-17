import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OrgPicker } from "@/features/auth/org-picker";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { listUserOrganizations } from "@/lib/server/owner-data";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Choose your business — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SelectOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const organizations = await listUserOrganizations();

  if (organizations.length === 0) redirect("/onboarding");
  if (organizations.length === 1) redirect("/home");

  const { next } = await searchParams;
  const origin = process.env.PUBLIC_FRONTEND_URL || "http://localhost:3000";
  const destination = safeInternalPath(next, origin);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <h1 className="mb-2 text-center text-2xl font-semibold tracking-[-0.02em] text-ink">
        Choose your business
      </h1>
      <p className="mb-8 text-center text-base text-muted">
        You belong to more than one. Pick the one you want to work with now.
      </p>

      <OrgPicker organizations={organizations} next={destination} />
    </main>
  );
}
