import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * GET /api/v1/home: the website's Home, for the iPhone app.
 *
 * What it must guarantee: the same model and words the website's Home shows
 * (one product on either screen); every read made with the caller's own
 * client (Row Level Security), never the service role; and nothing in the
 * unread rows beyond what the list needs (no note text).
 */

const db = {
  from: (table: string) => {
    expect(table).toBe("organizations");
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: { name: "Mario's Pizza", timezone: "America/New_York" }, error: null }),
    };
    return chain;
  },
};

let role = "owner";
const readsWith: unknown[] = [];

vi.mock("@/lib/server/auth", () => ({
  requireOrganizationContext: vi.fn(async () => ({ userId: "user-1", orgId: "org-1", role, db })),
}));

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => {
    throw new Error("the service role must not be used on an owner route");
  },
}));

vi.mock("@/lib/server/owner-data", () => {
  const seen = <T,>(value: T) => (...args: unknown[]) => {
    readsWith.push(args.at(-1));
    return Promise.resolve(value);
  };
  return {
    getOwnerCounts: seen({
      ratingsToday: 1,
      unread: 2,
      unreadLow: 1,
      openLow: 1,
      activeStands: 2,
      recentCount: 9,
      hasGoogleLink: true,
      ratingsThisWeek: 5,
      ratingsLastWeek: 2,
    }),
    listStands: seen([
      { standId: "stand-1", label: "Front counter", status: "active", nfcProvisionedAt: "2026-10-01T00:00:00Z", tokenRotatedAt: null },
      { standId: "stand-2", label: "Patio", status: "active", nfcProvisionedAt: "2026-10-01T00:00:00Z", tokenRotatedAt: null },
    ]),
    listLocations: seen([{ locationId: "loc-1", name: "Main" }]),
    listReviews: seen({
      items: [
        {
          responseId: "r-1",
          rating: 2,
          note: "Cold pizza, long wait",
          submittedAt: "2026-11-02T18:00:00Z",
          isRead: false,
          isResolved: false,
          standId: "stand-2",
        },
      ],
    }),
    hasPublishedCustomerPhoto: seen(true),
    getFeedbackInsights: seen({ state: "full", current: { average: 4.33, total: 12 }, comparison: null }),
    getServiceState: seen("serving"),
  };
});

function get(): Promise<Response> {
  return import("@/app/api/v1/home/route").then(({ GET }) =>
    GET(
      new Request("https://app.reviewboost.test/api/v1/home", {
        headers: { authorization: "Bearer token", "x-organization-id": "org-1" },
      }) as unknown as NextRequest,
    ),
  );
}

beforeEach(() => {
  role = "owner";
  readsWith.length = 0;
});

describe("GET /api/v1/home", () => {
  it("gives the app the website's Home: what needs them, the numbers and unread ratings", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as {
      data: {
        businessName: string;
        unreadCount: number;
        model: { kind: string; attentions: Array<{ kind: string }>; week: { count: number; change: string | null } | null };
        insights: { average: string; total: number } | null;
        tagStatusLine: string;
        unread: Array<Record<string, unknown>>;
      };
    };

    expect(data.businessName).toBe("Mario's Pizza");
    expect(data.unreadCount).toBe(2);
    expect(data.model.kind).toBe("active");
    expect(data.model.attentions.map((attention) => attention.kind)).toContain("unread");
    expect(data.model.week).toEqual({ count: 5, change: "3 more than last week" });
    expect(data.insights).toEqual({ average: "4.3", total: 12, direction: null });
    expect(typeof data.tagStatusLine).toBe("string");
    // With more than one Tag, each rating says which one it came from.
    expect(data.unread).toEqual([
      {
        id: "r-1",
        rating: 2,
        submittedAt: "2026-11-02T18:00:00Z",
        isRead: false,
        isResolved: false,
        hasNote: true,
        tagLabel: "Patio",
      },
    ]);
    // The note itself stays on the rating screen.
    expect(JSON.stringify(data)).not.toContain("Cold pizza");
  });

  it("makes every read with the caller's own client", async () => {
    await get();
    expect(readsWith.length).toBe(7);
    for (const client of readsWith) expect(client).toBe(db);
  });

  it("never offers billing to someone who cannot manage it", async () => {
    role = "member";
    const { data } = (await (await get()).json()) as { data: { model: { primary: { href: string } | null } } };
    expect(data.model.primary?.href).not.toBe("/settings/billing");
  });
});
