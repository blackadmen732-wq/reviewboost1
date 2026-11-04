import QRCode from "qrcode";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Tag is dumb; ReviewBoost is the routing layer.
 *
 * A QR code and an NFC chip carry `{ReviewBoost origin}/q/{public token}` and
 * nothing else. These tests prove it from the outside: the real QR route is
 * called and its output compared, byte for byte, with the QR code of the
 * canonical Tag URL — so a Google link, a query string or any other payload
 * would fail here. The database half (a changed destination or page reaches
 * the same Tag; nobody else can change it; bad destinations fail closed) is in
 * supabase/tests/tag_routing_invariants_test.sql.
 */

vi.mock("server-only", () => ({}));

const KEY = Buffer.alloc(32, 7).toString("base64");
const ORIGIN = "https://app.reviewboost.example";
const STAND_ID = "00000000-0000-4000-8000-000000000031";
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const GOOGLE = "https://search.google.com/local/writereview?placeid=ChIJRouteMain0001";

let storedCiphertext: string | null = null;

vi.mock("@/lib/server/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/server/auth")>();
  return {
    ...actual,
    requireOrganizationContext: async () => ({
      userId: "user-1",
      orgId: ORG_ID,
      role: "owner",
      db: {
        // The Tag row as RLS returns it to its own owner. Note what the row
        // carries — a label and the reprint ciphertext — and what it cannot:
        // the location's destination is not a column of a Tag at all.
        from: () => {
          const query = {
            select: () => query,
            eq: () => query,
            maybeSingle: async () => ({
              data: { id: STAND_ID, label: "Front counter", public_token_encrypted: storedCiphertext },
              error: null,
            }),
          };
          return query;
        },
      },
    }),
  };
});

let TOKEN = "";

beforeAll(async () => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.PUBLIC_FRONTEND_URL = ORIGIN;
  const { encrypt, generateToken } = await import("@/lib/server/crypto");
  TOKEN = generateToken();
  storedCiphertext = encrypt(TOKEN);
});

async function callQr(format: "svg" | "png" | "json") {
  const { GET } = await import("@/app/api/v1/review-stands/[standId]/qr/route");
  const request = new Request(`${ORIGIN}/api/v1/review-stands/${STAND_ID}/qr?format=${format}`, {
    headers: { Authorization: "Bearer test" },
  });
  return GET(request as never, { params: Promise.resolve({ standId: STAND_ID }) });
}

const QR_OPTIONS = {
  errorCorrectionLevel: "H" as const,
  margin: 2,
  color: { dark: "#111827", light: "#FFFFFF" },
};

describe("what a physical Tag carries", () => {
  it("the NFC payload is exactly the canonical ReviewBoost Tag URL", async () => {
    const response = await callQr("json");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { standUrl: string } };
    expect(body.data.standUrl).toBe(`${ORIGIN}/q/${TOKEN}`);
    expect(JSON.stringify(body)).not.toMatch(/google|g\.page|goo\.gl|placeid/i);
  });

  it("the printed QR encodes exactly that URL, and not the Google link", async () => {
    const response = await callQr("svg");
    expect(response.status).toBe(200);
    const svg = await response.text();
    const canonical = await QRCode.toString(`${ORIGIN}/q/${TOKEN}`, { ...QR_OPTIONS, type: "svg" });
    const google = await QRCode.toString(GOOGLE, { ...QR_OPTIONS, type: "svg" });
    expect(svg).toBe(canonical);
    expect(svg).not.toBe(google);
  });

  it("the downloadable PNG encodes the same URL", async () => {
    const response = await callQr("png");
    const png = Buffer.from(await response.arrayBuffer());
    const canonical = await QRCode.toBuffer(`${ORIGIN}/q/${TOKEN}`, { ...QR_OPTIONS, type: "png", width: 512 });
    expect(png.equals(canonical)).toBe(true);
  });

  it("the payload is built from the origin and token alone, so a destination change needs no regeneration", async () => {
    // Nothing the route reads can name a destination; the same Tag yields the
    // same bytes before and after any change an owner makes in Settings.
    const before = await (await callQr("svg")).text();
    const after = await (await callQr("svg")).text();
    expect(after).toBe(before);
    const source = (await import("node:fs")).readFileSync(
      (await import("node:path")).join(process.cwd(), "lib/server/owner-service.ts"),
      "utf8",
    );
    const reprint = source.slice(source.indexOf("export async function getStandTokenForReprint"));
    const select = reprint.slice(0, reprint.indexOf("maybeSingle"));
    expect(select).not.toMatch(/destination|google|location/i);
  });
});

describe("canonicalTagUrl", () => {
  beforeEach(() => {
    process.env.PUBLIC_FRONTEND_URL = ORIGIN;
  });

  it("is the configured origin, /q/, and the token", async () => {
    const { canonicalTagUrl } = await import("@/lib/server/tag-url");
    expect(canonicalTagUrl("AbCdEfGh12345678_-")).toBe(`${ORIGIN}/q/AbCdEfGh12345678_-`);
  });

  it("fails closed rather than issue anything else", async () => {
    const { canonicalTagUrl } = await import("@/lib/server/tag-url");
    for (const token of ["short", "has space here", "a/../../evil", "x".repeat(200), "tok?next=https://g.page/r/x/review"]) {
      expect(() => canonicalTagUrl(token), token).toThrow();
    }
  });

  it("is the only builder production code uses for a Tag, a QR, an NFC chip or a Text Request link", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const path of ["lib/server/owner-service.ts", "lib/server/sms/text-request-service.ts"]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source, path).not.toMatch(/standUrl\(publicFrontendUrl/);
      expect(source, path).not.toMatch(/`\$\{[^}]*\}\/q\//);
    }
  });
});

describe("isReviewBoostTagUrl", () => {
  it("accepts only a plain ReviewBoost /q/ link", async () => {
    const { isReviewBoostTagUrl } = await import("@/lib/security/tag-url");
    expect(isReviewBoostTagUrl(`${ORIGIN}/q/AbCdEfGh12345678`)).toBe(true);
    expect(isReviewBoostTagUrl(`${ORIGIN}/q/AbCdEfGh12345678`, ORIGIN)).toBe(true);
    expect(isReviewBoostTagUrl("http://localhost:3000/q/AbCdEfGh12345678")).toBe(true);

    for (const payload of [
      GOOGLE,
      "https://g.page/r/RouteMain/review",
      "https://maps.app.goo.gl/abc123",
      "https://www.google.com/q/AbCdEfGh12345678",
      `${ORIGIN}/q/AbCdEfGh12345678?next=${encodeURIComponent(GOOGLE)}`,
      `${ORIGIN}/q/AbCdEfGh12345678#${GOOGLE}`,
      `${ORIGIN}/r/AbCdEfGh12345678`,
      `${ORIGIN}/q/AbCdEfGh12345678/extra`,
      `${ORIGIN}/q/short`,
      "http://app.reviewboost.example/q/AbCdEfGh12345678",
      "https://user:pass@app.reviewboost.example/q/AbCdEfGh12345678",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isReviewBoostTagUrl(payload), payload).toBe(false);
    }
    expect(isReviewBoostTagUrl(`${ORIGIN}/q/AbCdEfGh12345678`, "https://other.example")).toBe(false);
  });

  it("is the same rule in the native app, which writes the NFC chips", async () => {
    const web = await import("@/lib/security/tag-url");
    const native = await import("../../../apps/mobile/lib/tag-url");
    for (const payload of [
      `${ORIGIN}/q/AbCdEfGh12345678`,
      GOOGLE,
      `${ORIGIN}/q/AbCdEfGh12345678?x=1`,
      "https://g.page/r/x/review",
      "http://localhost:3000/q/AbCdEfGh12345678",
    ]) {
      expect(native.isReviewBoostTagUrl(payload), payload).toBe(web.isReviewBoostTagUrl(payload));
    }
  });
});

describe("Google destinations: a review-writing link, kept server-side", () => {
  const REVIEW_LINKS = [
    "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    "https://g.page/r/CdSAMPLE/review",
    "https://g.page/r/CdSAMPLE/review?utm_source=qr",
  ];
  const NOT_REVIEW_LINKS = [
    "https://www.google.com/maps/place/Route+Main",
    "https://maps.google.com/maps/place/Route+Main",
    "https://maps.app.goo.gl/abc123",
    "https://g.page/corner-cafe",
    "https://g.page/r/CdSAMPLE",
    "https://search.google.com/local/writereview",
    "https://search.google.com/local/writereview?placeid=",
    "https://search.google.com/local/reviews?placeid=ChIJabc",
    "https://www.google.com/local/writereview?placeid=ChIJabc",
    "https://evil.example/local/writereview?placeid=ChIJabc",
    "http://search.google.com/local/writereview?placeid=ChIJabc",
  ];

  it("a new or changed destination must open Google's review-writing box", async () => {
    const { isGoogleReviewWritingUrl } = await import("@/lib/security/google-review-url");
    const server = await import("@/lib/server/destination");
    for (const url of REVIEW_LINKS) {
      expect(isGoogleReviewWritingUrl(url), url).toBe(true);
      expect(server.isWritableDestinationUrl("google", url), url).toBe(true);
    }
    for (const url of NOT_REVIEW_LINKS) {
      expect(isGoogleReviewWritingUrl(url), url).toBe(false);
      expect(server.isWritableDestinationUrl("google", url), url).toBe(false);
    }
    expect(server.isWritableDestinationUrl("yelp", REVIEW_LINKS[0])).toBe(false);
  });

  it("a destination saved before the rule still resolves, so no Tag in the field goes dark", async () => {
    const { resolveDestination } = await import("@/lib/server/destination");
    const legacy = "https://www.google.com/maps/place/Route+Main";
    expect(
      resolveDestination({ destination_provider: "google", destination_url: legacy, google_review_url: legacy }),
    ).toEqual({ provider: "google", url: legacy });
  });

  it("an invalid or unapproved destination resolves to a closed door, never a redirect", async () => {
    const { resolveDestination } = await import("@/lib/server/destination");
    for (const row of [
      { destination_provider: "google", destination_url: "https://evil.example/redirect", google_review_url: null },
      { destination_provider: "yelp", destination_url: "https://www.yelp.com/biz/x", google_review_url: null },
      { destination_provider: null, destination_url: null, google_review_url: "javascript:alert(1)" },
      { destination_provider: null, destination_url: null, google_review_url: null },
    ]) {
      expect(resolveDestination(row), JSON.stringify(row)).toBeNull();
    }
  });

  it("the Settings write refuses a Maps listing before it reaches the database", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const route = readFileSync(join(process.cwd(), "app/api/v1/settings/route.ts"), "utf8");
    expect(route).toMatch(/isWritableDestinationUrl\(provider, value\.destinationUrl\)/);
    const onboarding = readFileSync(join(process.cwd(), "lib/server/owner-service.ts"), "utf8");
    expect(onboarding).toMatch(/!isGoogleReviewWritingUrl\(input\.googleReviewUrl\)/);
  });

  it("agrees with the database's strict rule", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(
      join(process.cwd(), "../supabase/migrations/20260927000100_tag_routing_invariants.sql"),
      "utf8",
    );
    expect(sql).toContain("v_path = '/local/writereview'");
    expect(sql).toContain("'&placeid=[A-Za-z0-9_-]+(&|$)'");
    expect(sql).toContain("'^/r/[A-Za-z0-9_-]+/review/?$'");
  });
});
