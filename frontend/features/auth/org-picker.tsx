"use client";

import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { SettingGroup, SettingRow } from "@/components/ui/setting-list";
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
    <>
      {/* One card, one row per business. A picker is a list of doors, so it
          gets the same shape every other list of doors in the app has. */}
      <SettingGroup>
        {organizations.map((org) => (
          <SettingRow
            key={org.orgId}
            icon={Building2}
            title={org.name}
            description={org.role.charAt(0).toUpperCase() + org.role.slice(1)}
            onClick={() => select(org.orgId)}
            disabled={isPending}
            chevron
          />
        ))}
      </SettingGroup>

      {/* Was text-[color:var(--rb-error)] — a token that is not defined
          anywhere, so a failed switch announced itself in ordinary ink. */}
      {error ? (
        <p role="alert" className="-mt-4 text-center text-sm text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}
