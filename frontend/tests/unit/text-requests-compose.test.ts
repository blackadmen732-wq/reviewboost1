import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * GET /api/v1/text-requests also carries what a request may say and how a
 * customer can have agreed, so the iPhone app offers exactly the website's
 * approved words, never its own copy of them.
 */

const db = {
  rpc: () => Promise.resolve({ data: [{ monthly: 40, purchased: 2, total: 42 }], error: null }),
};

vi.mock("@/lib/server/auth", () => ({
  requireOrganizationContext: vi.fn(async () => ({ userId: "user-1", orgId: "org-1", role: "member", db })),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/server/supabase", () => ({ serviceRoleClient: () => ({}) }));
vi.mock("@/lib/server/sms/text-request-service", () => ({
  listTextRequests: vi.fn(async () => []),
  scheduleSchema: {},
  scheduleTextRequest: vi.fn(),
}));

describe("GET /api/v1/text-requests", () => {
  it("returns the approved messages and consent methods from the one file that defines them", async () => {
    const { GET } = await import("@/app/api/v1/text-requests/route");
    const templates = await import("@/lib/sms/text-request-templates");
    const response = await GET(
      new Request("https://app.reviewboost.test/api/v1/text-requests", {
        headers: { authorization: "Bearer token" },
      }) as unknown as NextRequest,
    );
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as {
      data: {
        balance: { total: number };
        compose: {
          templates: Array<{ id: string; text: string }>;
          defaultTemplateId: string;
          consentMethods: Array<{ id: string; label: string }>;
          consentWordingVersion: string;
        };
      };
    };

    expect(data.balance.total).toBe(42);
    expect(data.compose.templates).toEqual(
      templates.TEXT_REQUEST_TEMPLATE_IDS.map((id) => ({ id, text: templates.TEXT_REQUEST_TEMPLATES[id] })),
    );
    expect(data.compose.defaultTemplateId).toBe(templates.DEFAULT_TEXT_REQUEST_TEMPLATE_ID);
    expect(data.compose.consentMethods.map((method) => method.id)).toEqual(templates.CONSENT_METHOD_IDS);
    expect(data.compose.consentWordingVersion).toBe(templates.CONSENT_ATTESTATION_VERSION);
  });
});
