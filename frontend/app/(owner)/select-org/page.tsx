import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { OrgPicker } from "@/features/auth/org-picker";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { publicFrontendUrl } from "@/lib/server/env";
import { listUserOrganizations } from "@/lib/server/owner-data";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Choose your business",
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
  // Guarded accessor rather than a silent localhost fallback — see login/page.
  const destination = safeInternalPath(next, publicFrontendUrl());

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <PageHeader
        title="Choose your business"
        description="You belong to more than one. Pick the one you want to work with now."
        align="center"
      />

      <OrgPicker organizations={organizations} next={destination} />
    </main>
  );
}
