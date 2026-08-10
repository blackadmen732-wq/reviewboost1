import type { Metadata } from "next";
import { Globe, Mail, MapPin, Store } from "lucide-react";
import { redirect } from "next/navigation";

import { AppShell } from "@/features/dashboard/app-shell";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Settings.
 *
 * Read-only for now, and honest about it. Showing the real values is worth
 * something on its own — an owner checking "did my Google link save?" gets an
 * answer — and a form that pretends to save and does not would be worse than no
 * form.
 *
 * The one thing that must work is signing out, which until now existed nowhere
 * in the app at all.
 */
export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings");

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id, role, organizations(name, slug, timezone)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  const membership = memberships?.[0] as
    | {
        org_id: string;
        role: string;
        organizations: { name: string; slug: string; timezone: string } | null;
      }
    | undefined;

  const { data: locations } = membership
    ? await supabase
        .from("locations")
        .select("name, google_review_url")
        .eq("org_id", membership.org_id)
        .limit(1)
    : { data: null };

  const location = locations?.[0] as
    | { name: string; google_review_url: string | null }
    | undefined;

  return (
    <AppShell businessName={membership?.organizations?.name}>
        <h1 className="mb-6 text-2xl font-semibold tracking-[-0.02em] text-ink">Settings</h1>

        <div className="mb-6 flex flex-col gap-3">
          <Row icon={Store} label="Business" value={membership?.organizations?.name ?? "—"} />
          <Row icon={MapPin} label="Location" value={location?.name ?? "—"} />
          <Row
            icon={Globe}
            label="Google link"
            value={location?.google_review_url ?? "Not set yet"}
            // The one field where absence is a problem worth flagging: without
            // it a stand cannot serve customers at all.
            warn={!location?.google_review_url}
          />
          <Row icon={Mail} label="Signed in as" value={user.email ?? "—"} />
        </div>

        <SignOutButton />

        <p className="mt-8 text-center text-sm text-muted">
          To change these, message support. Editing is coming.
        </p>
      </AppShell>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  warn = false,
}: {
  icon: typeof Store;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
        <Icon className="size-5 text-muted" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-muted">{label}</p>
        {/* break-words, not truncate: a Google URL is long and unrecognisable
            when cut off, and the point of showing it is recognition. */}
        <p
          className={
            warn
              ? "break-words text-base font-medium text-[color:var(--rb-warning)]"
              : "break-words text-base font-medium text-ink"
          }
        >
          {value}
        </p>
      </div>
    </div>
  );
}
