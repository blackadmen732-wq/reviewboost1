import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  OPT_OUT_LINE,
  SENDER_NAME_MAX,
  TEXT_REQUEST_TEMPLATES,
  TEXT_REQUEST_TEMPLATE_IDS,
  consentAttestationText,
  renderTextRequest,
  senderName,
} from "@/lib/sms/text-request-templates";

vi.mock("server-only", () => ({}));

const LINK = "https://app.example.com/q/abcdefgh12345678";

describe("Text Request templates — every text says who it is from and how to stop it", () => {
  it("frames every approved message with the business name and the STOP line", () => {
    for (const templateId of TEXT_REQUEST_TEMPLATE_IDS) {
      const body = renderTextRequest({ businessName: "Corner Cafe", templateId, link: LINK });
      expect(body.startsWith("Corner Cafe: ")).toBe(true);
      expect(body.endsWith(`\n${OPT_OUT_LINE}`)).toBe(true);
      expect(body).toContain(LINK);
      expect(body).not.toContain("{{link}}");
    }
  });

  it("every approved message carries the link and asks about the visit, never a rating", () => {
    for (const text of Object.values(TEXT_REQUEST_TEMPLATES)) {
      expect(text).toContain("{{link}}");
      // No review gating, no incentives.
      expect(text).not.toMatch(/star|5\s*\/\s*5|discount|% off|free|reward/i);
    }
  });

  it("cleans the business name: no line breaks, collapsed spaces, capped length", () => {
    expect(senderName("  Corner\n\tCafe  ")).toBe("Corner Cafe");
    expect(senderName("A".repeat(80))).toHaveLength(SENDER_NAME_MAX);
    expect(senderName("\u0000\u0007")).toBe("");
  });

  it("never splits an emoji when cutting the name", () => {
    const name = `${"B".repeat(SENDER_NAME_MAX - 1)}🍕🍕`;
    const cut = senderName(name);
    expect(Array.from(cut)).toHaveLength(SENDER_NAME_MAX);
    expect(cut.endsWith("🍕")).toBe(true);
  });

  it("refuses to build a text with no business name", () => {
    expect(() =>
      renderTextRequest({ businessName: "  ", templateId: TEXT_REQUEST_TEMPLATE_IDS[0], link: LINK }),
    ).toThrow();
  });

  it("names the business in the consent statement", () => {
    expect(consentAttestationText("Corner Cafe")).toContain("Corner Cafe");
    expect(consentAttestationText("")).toContain("this business");
  });
});

describe("Text Request segments are counted on the text actually sent", () => {
  const loadSegments = () => import("@/lib/server/sms/segments");

  it("the prefix and STOP line count toward the total", async () => {
    const { computeSegments } = await loadSegments();
    const templateId = TEXT_REQUEST_TEMPLATE_IDS[0];
    const bare = TEXT_REQUEST_TEMPLATES[templateId].replace("{{link}}", LINK);
    const body = renderTextRequest({ businessName: "Corner Cafe", templateId, link: LINK });
    expect(computeSegments(body).unitCount).toBeGreaterThan(computeSegments(bare).unitCount);
  });

  it("an emoji in the business name switches encoding for the whole text", async () => {
    const { computeSegments } = await loadSegments();
    const templateId = TEXT_REQUEST_TEMPLATE_IDS[0];
    const plain = renderTextRequest({ businessName: "Pizza Place", templateId, link: LINK });
    const emoji = renderTextRequest({ businessName: "Pizza Place 🍕", templateId, link: LINK });
    expect(computeSegments(plain).encoding).toBe("gsm7");
    expect(computeSegments(emoji).encoding).toBe("ucs2");
    expect(computeSegments(emoji).segments).toBeGreaterThanOrEqual(computeSegments(plain).segments);
  });
});

describe("The composer never records consent by sending (F-1 regression)", () => {
  const composer = readFileSync(
    join(process.cwd(), "features/dashboard/text-request-composer.tsx"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("does not send a consent field or a free-text message", () => {
    expect(composer).not.toMatch(/owner_import/);
    expect(composer).not.toMatch(/consent\s*:/);
    expect(composer).not.toMatch(/messageTemplate/);
    expect(composer).not.toMatch(/<textarea/);
  });

  it("records consent only through the explicit endpoint, with a literal confirmation", () => {
    expect(composer).toMatch(/text-requests\/consent/);
    expect(composer).toMatch(/confirmed:\s*true/);
    expect(composer).toMatch(/CONSENT_ATTESTATION_VERSION/);
  });
});
