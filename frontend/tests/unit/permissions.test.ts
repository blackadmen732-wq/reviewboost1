import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { permissionsFor, ROLES, type Permissions } from "@/lib/owner/permissions";

/**
 * The interface offers an action only to a role the API accepts.
 *
 * `permissions.ts` mirrors the `requireRole` lists in the route handlers. This
 * reads those handlers, so a route that tightens or loosens a role without the
 * mirror following fails here instead of in front of an admin as a 403.
 */

function allowed(route: string, method: string): string[] {
  const source = readFileSync(resolve(__dirname, "../../app/api/v1", route, "route.ts"), "utf8");
  const start = source.indexOf(`export async function ${method}(`);
  expect(start, `${route} has no ${method}`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("export async function", start + 1);
  const body = source.slice(start, next === -1 ? undefined : next);
  const match = body.match(/requireRole\(context\.role, \[([^\]]+)\]\)/);
  if (match?.[1]) return [...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1] ?? "");
  // The settings route checks inline rather than through requireRole.
  if (/context\.role !== "owner" && context\.role !== "admin"/.test(body)) return ["owner", "admin"];
  throw new Error(`${route} ${method} has no role check this test understands`);
}

const MIRRORS: Array<[keyof Permissions, string, string]> = [
  ["manageBilling", "billing", "POST"],
  ["manageTags", "review-stands", "POST"],
  ["manageTags", "review-stands/[standId]/qr", "GET"],
  ["manageTags", "review-stands/[standId]/nfc-provision", "POST"],
  ["manageTags", "review-stands/[standId]/rotate-token", "POST"],
  ["sendTextRequests", "text-requests", "POST"],
  ["sendTextRequests", "text-requests/preview", "POST"],
  ["editSettings", "settings", "PATCH"],
  ["editSettings", "locations", "POST"],
  ["editCustomerPage", "customer-page", "PUT"],
];

describe("permissions mirror the API", () => {
  it.each(MIRRORS)("%s matches %s %s", (permission, route, method) => {
    const accepted = allowed(route, method);
    for (const role of ROLES) {
      expect(permissionsFor(role)[permission], `${role} on ${route} ${method}`).toBe(
        accepted.includes(role),
      );
    }
  });

  it("gives an unknown role nothing", () => {
    expect(Object.values(permissionsFor("superuser")).some(Boolean)).toBe(false);
    expect(Object.values(permissionsFor(undefined)).some(Boolean)).toBe(false);
  });
});
