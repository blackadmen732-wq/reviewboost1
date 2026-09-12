import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, signIn, cleanupTestUser } from "./setup";

/**
 * Multi-tenant isolation test.
 *
 * Creates two organizations with separate owners and verifies that neither
 * can read the other's data through any query path.
 */
describe("Tenant isolation", () => {
  let userA: { id: string };
  let userB: { id: string };
  let orgIdA: string;
  let orgIdB: string;
  let sessionA: Awaited<ReturnType<typeof signIn>>;
  let sessionB: Awaited<ReturnType<typeof signIn>>;

  beforeAll(async () => {
    const admin = serviceClient();

    userA = await createTestUser("tenant-a@test.local");
    userB = await createTestUser("tenant-b@test.local");

    // Create orgs via service role
    const { data: orgA } = await admin
      .from("organizations")
      .insert({ name: "Org A", timezone: "America/New_York" })
      .select("id")
      .single();

    const { data: orgB } = await admin
      .from("organizations")
      .insert({ name: "Org B", timezone: "America/Los_Angeles" })
      .select("id")
      .single();

    orgIdA = orgA!.id as string;
    orgIdB = orgB!.id as string;

    // Create memberships
    await admin.from("organization_members").insert([
      { org_id: orgIdA, user_id: userA.id, role: "owner", status: "active" },
      { org_id: orgIdB, user_id: userB.id, role: "owner", status: "active" },
    ]);

    // Create profiles for the users
    await admin.from("profiles").upsert([
      { id: userA.id, full_name: "User A" },
      { id: userB.id, full_name: "User B" },
    ]);

    sessionA = await signIn("tenant-a@test.local");
    sessionB = await signIn("tenant-b@test.local");
  });

  afterAll(async () => {
    const admin = serviceClient();
    await admin.from("organization_members").delete().in("org_id", [orgIdA, orgIdB]);
    await admin.from("organizations").delete().in("id", [orgIdA, orgIdB]);
    await cleanupTestUser(userA.id);
    await cleanupTestUser(userB.id);
  });

  it("user A cannot see org B's organization row", async () => {
    const { data } = await sessionA.client
      .from("organizations")
      .select("id, name")
      .eq("id", orgIdB)
      .maybeSingle();

    expect(data).toBeNull();
  });

  it("user B cannot see org A's organization row", async () => {
    const { data } = await sessionB.client
      .from("organizations")
      .select("id, name")
      .eq("id", orgIdA)
      .maybeSingle();

    expect(data).toBeNull();
  });

  it("user A can see their own organization", async () => {
    const { data } = await sessionA.client
      .from("organizations")
      .select("id, name")
      .eq("id", orgIdA)
      .single();

    expect(data).not.toBeNull();
    expect(data!.name).toBe("Org A");
  });

  it("user A cannot see org B's members", async () => {
    const { data } = await sessionA.client
      .from("organization_members")
      .select("id")
      .eq("org_id", orgIdB);

    expect(data).toEqual([]);
  });

  it("user A cannot read org B's review stands", async () => {
    const { data } = await sessionA.client
      .from("review_stands")
      .select("id")
      .eq("org_id", orgIdB);

    expect(data).toEqual([]);
  });
});
