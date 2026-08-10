import type { Metadata } from "next";
import { Eye, Globe, LifeBuoy, Mail, MapPin, Shield, Store } from "lucide-react";
import Link from "next/link";
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

        {/* A real person to contact, and a plain answer about customer data.
            A barber deciding whether to put our code on their counter wants to
            know who is behind it — a faceless product is one they will not
            recommend to the shop next door. */}
        <section className="mb-6 flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Help</h2>

          <a
            href="mailto:help@reviewboost.app"
            className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft">
              <LifeBuoy className="size-5 text-brand-text" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-ink">Ask us anything</p>
              <p className="text-sm text-muted">We answer every message.</p>
            </div>
          </a>

          {/* Seeing exactly what a customer sees is the single thing that makes
              an owner comfortable putting this on their counter. */}
          <Link
            href="/stands"
            className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
              <Eye className="size-5 text-muted" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-ink">See what customers see</p>
              <p className="text-sm text-muted">Scan your own code to try it.</p>
            </div>
          </Link>

          <div className="flex items-start gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-quiet">
              <Shield className="size-5 text-muted" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-ink">Your customers stay private</p>
              <p className="text-sm leading-relaxed text-muted">
                We never ask them for a name, phone number, or email. Private
                notes are locked so only you can read them.
              </p>
            </div>
          </div>
        </section>

        <SignOutButton />
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
