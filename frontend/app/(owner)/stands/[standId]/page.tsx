import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/features/dashboard/app-shell";
import { TagDetail } from "@/features/tags/tag-detail";
import { getStand, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Tag — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TagDetailPage({
  params,
}: {
  params: Promise<{ standId: string }>;
}) {
  const { standId } = await params;
  const { organization } = await requireOwner(`/stands/${standId}`);
  if (!UUID.test(standId)) notFound();
  const stand = await getStand(organization.orgId, standId);
  if (!stand) notFound();

  return (
    <AppShell businessName={organization.name}>
      <p className="mb-4">
        <Link
          href="/stands"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Tags
        </Link>
      </p>
      <TagDetail stand={stand} />
    </AppShell>
  );
}
