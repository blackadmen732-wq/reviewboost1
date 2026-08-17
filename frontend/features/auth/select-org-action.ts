"use server";

import { cookies } from "next/headers";

import { listUserOrganizations } from "@/lib/server/owner-data";

const ORG_COOKIE = "rb-active-org";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function selectOrganization(
  orgId: string,
): Promise<{ error: string } | null> {
  if (!UUID_RE.test(orgId)) {
    return { error: "Invalid organization." };
  }

  const organizations = await listUserOrganizations();
  const match = organizations.find((o) => o.orgId === orgId);

  if (!match) {
    return { error: "You do not belong to that organization." };
  }

  const store = await cookies();
  store.set(ORG_COOKIE, orgId, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return null;
}
