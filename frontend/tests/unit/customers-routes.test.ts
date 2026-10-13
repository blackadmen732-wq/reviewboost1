import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Customers routes: who may call them, what they accept, and what the export
 * returns. The service is stubbed; its own behaviour is in
 * customer-service.test.ts, and the database's role checks in
 * supabase/tests/customer_contacts_test.sql.
 */

let role = "owner";
vi.mock("@/lib/server/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/auth")>("@/lib/server/auth");
  return {
    ...actual,
    requireOrganizationContext: async () => ({ orgId: "org-1", userId: "u-1", role, db: {} }),
  };
});

const service = {
  listCustomers: vi.fn(async () => [{ id: "c1", name: "Ana", lastFour: "0142" }]),
  createCustomer: vi.fn(async () => ({ id: "c1", lastFour: "0142" })),
  updateCustomer: vi.fn(async () => ({ id: "c1", lastFour: "0142" })),
  deleteCustomer: vi.fn(async () => undefined),
  exportCustomers: vi.fn(async () => ({ csv: '"Name"\r\n"Ana"\r\n', count: 1 })),
};
vi.mock("@/lib/server/customers/customer-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/customers/customer-service")>(
    "@/lib/server/customers/customer-service",
  );
  return { ...actual, ...service };
});

const ID = "9a000000-0000-4000-8000-00000000000a";

function request(path: string, init: RequestInit = {}) {
  return new NextRequest(`https://app.example.com${path}`, init as never);
}

beforeEach(() => {
  role = "owner";
  for (const fn of Object.values(service)) fn.mockClear();
});

describe("/api/v1/customers", () => {
  it("lists for an owner and an admin", async () => {
    const { GET } = await import("@/app/api/v1/customers/route");
    for (const r of ["owner", "admin"]) {
      role = r;
      const response = await GET(request("/api/v1/customers"));
      expect(response.status).toBe(200);
      expect((await response.json()).data).toHaveLength(1);
    }
  });

  it("refuses a member and a viewer before touching the data", async () => {
    const { GET, POST } = await import("@/app/api/v1/customers/route");
    for (const r of ["member", "viewer"]) {
      role = r;
      expect((await GET(request("/api/v1/customers"))).status).toBe(403);
      expect(
        (
          await POST(
            request("/api/v1/customers", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ phone: "+15552010142" }),
            }),
          )
        ).status,
      ).toBe(403);
    }
    expect(service.listCustomers).not.toHaveBeenCalled();
    expect(service.createCustomer).not.toHaveBeenCalled();
  });

  it("rejects unknown fields, so a client cannot slip in consent or an org", async () => {
    const { POST } = await import("@/app/api/v1/customers/route");
    for (const extra of [{ consent: "opted_in" }, { orgId: "other" }]) {
      const response = await POST(
        request("/api/v1/customers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone: "+15552010142", ...extra }),
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(service.createCustomer).not.toHaveBeenCalled();
  });

  it("creates with 201", async () => {
    const { POST } = await import("@/app/api/v1/customers/route");
    const response = await POST(
      request("/api/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ana", phone: "+15552010142" }),
      }),
    );
    expect(response.status).toBe(201);
  });
});

describe("/api/v1/customers/[customerId]", () => {
  it("404s a malformed id without calling the service", async () => {
    const { DELETE } = await import("@/app/api/v1/customers/[customerId]/route");
    const response = await DELETE(request("/api/v1/customers/nope", { method: "DELETE" }), {
      params: Promise.resolve({ customerId: "nope" }),
    });
    expect(response.status).toBe(404);
    expect(service.deleteCustomer).not.toHaveBeenCalled();
  });

  it("updates and removes for an owner, and refuses a viewer", async () => {
    const { PATCH, DELETE } = await import("@/app/api/v1/customers/[customerId]/route");
    const params = { params: Promise.resolve({ customerId: ID }) };
    const patch = await PATCH(
      request(`/api/v1/customers/${ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ana B" }),
      }),
      params,
    );
    expect(patch.status).toBe(200);
    expect(service.updateCustomer).toHaveBeenCalledWith(expect.anything(), ID, { name: "Ana B" }, expect.any(String));

    expect((await DELETE(request(`/api/v1/customers/${ID}`, { method: "DELETE" }), params)).status).toBe(200);

    role = "viewer";
    expect(
      (await DELETE(request(`/api/v1/customers/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ customerId: ID }) }))
        .status,
    ).toBe(403);
  });
});

describe("/api/v1/customers/export", () => {
  it("returns a private CSV download for an owner", async () => {
    const { GET } = await import("@/app/api/v1/customers/export/route");
    const response = await GET(request("/api/v1/customers/export"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="reviewboost-customers-/);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(await response.text()).toContain('"Ana"');
  });

  it("refuses a member", async () => {
    role = "member";
    const { GET } = await import("@/app/api/v1/customers/export/route");
    expect((await GET(request("/api/v1/customers/export"))).status).toBe(403);
    expect(service.exportCustomers).not.toHaveBeenCalled();
  });
});
