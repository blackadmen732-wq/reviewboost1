"use client";

import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import type { CurrentOrganization } from "@/lib/server/owner-data";
import { selectOrganization } from "@/features/auth/select-org-action";

export function OrgPicker({
  organizations,
  next,
}: {
  organizations: CurrentOrganization[];
  next: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const select = useCallback(
    (orgId: string) => {
      setError(null);
      startTransition(async () => {
        const result = await selectOrganization(orgId);
        if (result?.error) {
          setError(result.error);
          return;
        }
        router.push(next);
        router.refresh();
      });
    },
    [next, router],
  );

  return (
    <div className="flex flex-col gap-3">
      {organizations.map((org) => (
        <button
          key={org.orgId}
          type="button"
          disabled={isPending}
          onClick={() => select(org.orgId)}
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-left transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:opacity-60"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft">
            <Building2 className="size-5 text-brand-text" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-medium text-ink">{org.name}</p>
            <p className="text-sm text-muted capitalize">{org.role}</p>
          </div>
        </button>
      ))}

      {error ? <p className="mt-2 text-center text-sm text-[color:var(--rb-error)]">{error}</p> : null}
    </div>
  );
}
