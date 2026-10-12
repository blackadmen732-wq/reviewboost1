import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { fakeProviderEnabled } from "@/lib/server/integrations/registry";
import { requireOwner } from "@/lib/server/owner-data";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Test provider — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ACCOUNTS = [
  { code: "fake_DEMO", label: "Demo business", hint: "Works normally" },
  { code: "fake_PARTIAL", label: "Partial permission", hint: "Gives one permission fewer than asked" },
  { code: "fake_DOWN", label: "Down", hint: "Every read fails as an outage" },
  { code: "fake_REVOKED", label: "Revoked", hint: "Every read fails as removed access" },
] as const;

/**
 * The test provider's own "allow access" screen, standing in for Square's.
 * It exists only where the test provider is switched on, never in
 * production. It sends the browser back to our callback page exactly as a
 * real provider would, with a code or an error, and only ever to that page.
 */
export default async function FakeConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { provider } = await params;
  if (provider !== "fake" || !fakeProviderEnabled()) notFound();
  const { organization } = await requireOwner("/settings/connections");
  if (!["owner", "admin"].includes(organization.role)) notFound();

  const query = await searchParams;
  const state = typeof query.state === "string" ? query.state : "";
  const scope = typeof query.scope === "string" ? query.scope : "";
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(state)) notFound();

  // Never an open redirect: the form always posts back to our own callback.
  const callback = "/settings/connections/fake/callback";
  const deny = `${callback}?${new URLSearchParams({ state, error: "access_denied" }).toString()}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 bg-canvas p-6">
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Test provider</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Allow ReviewBoost to read your data?</h1>
        <p className="mt-2 text-base text-muted">
          This is a pretend app for trying Connections. Nothing here is a real person or business.
        </p>
        <ul className="mt-4 list-disc pl-5 text-sm text-ink">
          {scope.split(" ").filter(Boolean).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <form method="get" action={callback} className="flex flex-col gap-3">
        <input type="hidden" name="state" value={state} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Sign in as</legend>
          {ACCOUNTS.map((account, index) => (
            <label key={account.code} className="flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface p-3">
              <input type="radio" name="code" value={account.code} defaultChecked={index === 0} className="mt-1" />
              <span>
                <span className="block text-base font-medium text-ink">{account.label}</span>
                <span className="block text-sm text-muted">{account.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className={cn(buttonVariants({ variant: "primary" }))}>
          Allow
        </button>
        <a href={deny} className={cn(buttonVariants({ variant: "secondary" }))}>
          Deny
        </a>
      </form>
    </main>
  );
}
