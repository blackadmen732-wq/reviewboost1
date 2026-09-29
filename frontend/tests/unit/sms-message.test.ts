import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The final outbound body.
 *
 * What is proved: every message names the business and carries an opt-out
 * that the inbound handler honours; the preview counts segments on exactly
 * that text; and the text the schedule encrypts for dispatch — which is what
 * the provider receives — is the same string, character for character.
 */

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: [{ request_id: "r-1", created: true }], error: null });
    },
  }),
}));

const TOKEN = "tokentokentoken";
const LINK = `https://app.example.com/q/${TOKEN}`;

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.PUBLIC_FRONTEND_URL = "https://app.example.com";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
});

afterEach(() => {
  delete process.env.SMS_OPT_OUT_FOOTER;
  rpcCalls.length = 0;
});

function context(businessName: string | null, orgError: unknown = null) {
  const rows: Record<string, { data: unknown; error: unknown }> = {
    review_stands: { data: { id: "s1", location_id: "l1", public_token_encrypted: null }, error: null },
    locations: { data: { timezone: "America/New_York" }, error: null },
    organizations: { data: businessName === null ? null : { name: businessName }, error: orgError },
  };
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => rows[table],
      };
      return builder;
    },
  };
  return { orgId: "7c000000-0000-0000-0000-00000000000a", userId: "u-1", role: "owner", db } as never;
}

describe("composeTextRequestBody", () => {
  it("names the business, carries the link, and ends with the opt-out", async () => {
    const { composeTextRequestBody } = await import("@/lib/server/sms/message");
    expect(composeTextRequestBody({ businessName: "Harbor Dental", link: LINK })).toBe(
      `Harbor Dental: How was your visit? Tap here to leave a review: ${LINK} Reply STOP to opt out.`,
    );
  });

  it("keeps the owner's words but not their power to drop the name or the opt-out", async () => {
    const { composeTextRequestBody } = await import("@/lib/server/sms/message");
    const body = composeTextRequestBody({
      businessName: "Harbor Dental",
      link: LINK,
      template: "Thanks for coming in! {{link}}",
    });
    expect(body.startsWith("Harbor Dental: ")).toBe(true);
    expect(body.endsWith(" Reply STOP to opt out.")).toBe(true);
    expect(body).toContain(LINK);
  });

  it("does not name the business twice when the owner already did", async () => {
    const { composeTextRequestBody } = await import("@/lib/server/sms/message");
    expect(
      composeTextRequestBody({
        businessName: "Harbor Dental",
        link: LINK,
        template: "Harbor Dental here — how did we do? {{link}}",
      }),
    ).toBe(`Harbor Dental here — how did we do? ${LINK} Reply STOP to opt out.`);
  });

  it("refuses to send a message that cannot say who it is from", async () => {
    const { composeTextRequestBody, MessageCompositionError } = await import("@/lib/server/sms/message");
    for (const name of [null, "", "   ", "\n\t"]) {
      expect(() => composeTextRequestBody({ businessName: name, link: LINK })).toThrow(
        MessageCompositionError,
      );
    }
  });

  it("puts a business name on one line, and keeps it short", async () => {
    const { smsBusinessName } = await import("@/lib/server/sms/message");
    expect(smsBusinessName("Harbor\nDental\u0000 Co")).toBe("Harbor Dental Co");
    expect(Array.from(smsBusinessName("A".repeat(80)) ?? "")).toHaveLength(40);
  });

  it("refuses a body longer than the provider will carry", async () => {
    const { composeTextRequestBody, MessageCompositionError } = await import("@/lib/server/sms/message");
    expect(() =>
      composeTextRequestBody({ businessName: "Harbor", link: "x".repeat(1600), template: "{{link}}" }),
    ).toThrow(MessageCompositionError);
  });
});

describe("the opt-out for the live messaging configuration", () => {
  it("defaults to the standard copy", async () => {
    const { messagingConfig } = await import("@/lib/server/sms/message");
    expect(messagingConfig().optOutFooter).toBe("Reply STOP to opt out.");
  });

  it("uses the registered wording when one is configured", async () => {
    process.env.SMS_OPT_OUT_FOOTER = "Msg&data rates may apply. Reply STOP to end.";
    const { composeTextRequestBody } = await import("@/lib/server/sms/message");
    expect(composeTextRequestBody({ businessName: "Harbor", link: LINK })).toMatch(
      / Msg&data rates may apply\. Reply STOP to end\.$/,
    );
  });

  it("refuses wording that does not name a keyword that really opts out", async () => {
    const { messagingConfig } = await import("@/lib/server/sms/message");
    const { ConfigError } = await import("@/lib/server/env");
    for (const footer of [
      "Reply NO to opt out.",
      "reply stop to opt out.", // a keyword in lowercase is not an instruction anyone reads as one
      "Text us to unsubscribe.",
    ]) {
      process.env.SMS_OPT_OUT_FOOTER = footer;
      expect(() => messagingConfig(), footer).toThrow(ConfigError);
    }
  });

  it("refuses wording that would silently switch every message to UCS-2", async () => {
    process.env.SMS_OPT_OUT_FOOTER = "Reply STOP if you’d rather not hear from us.";
    const { messagingConfig } = await import("@/lib/server/sms/message");
    const { ConfigError } = await import("@/lib/server/env");
    expect(() => messagingConfig()).toThrow(ConfigError);
  });

  it("names a keyword the inbound handler classifies as STOP", async () => {
    const { DEFAULT_OPT_OUT_FOOTER } = await import("@/lib/server/sms/message");
    const { classifyKeyword } = await import("@/lib/server/sms/keywords");
    const keyword = DEFAULT_OPT_OUT_FOOTER.split(" ")[1];
    expect(classifyKeyword(keyword)).toBe("stop");
  });
});

describe("preview and schedule agree with what the provider receives", () => {
  it("counts segments on the final body, not on the owner's template", async () => {
    const { previewTextRequest } = await import("@/lib/server/sms/text-request-service");
    const { composeTextRequestBody } = await import("@/lib/server/sms/message");
    const { computeSegments } = await import("@/lib/server/sms/segments");

    const preview = await previewTextRequest(context("Harbor Dental"), {
      phone: "+15555550123",
      standToken: TOKEN,
    });

    const expected = composeTextRequestBody({ businessName: "Harbor Dental", link: LINK });
    expect(preview.body).toBe(expected);
    expect(preview.unitCount).toBe(computeSegments(expected).unitCount);
    expect(preview.segments).toBe(computeSegments(expected).segments);
    // Counted on the name, link and opt-out too — not on the template alone.
    const templateOnly = computeSegments(`How was your visit? Tap here to leave a review: ${LINK}`);
    expect(preview.unitCount).toBe(templateOnly.unitCount + "Harbor Dental: ".length + " Reply STOP to opt out.".length);
  });

  it("crosses into a second segment where the final body does, even if the template would not", async () => {
    const { previewTextRequest } = await import("@/lib/server/sms/text-request-service");
    const { computeSegments } = await import("@/lib/server/sms/segments");
    // A template that, with its link, fills exactly one segment on its own —
    // and two once the business name and opt-out are added.
    const template = `${"a".repeat(160 - LINK.length - 1)} {{link}}`;
    expect(computeSegments(template.replace("{{link}}", LINK)).segments).toBe(1);

    const preview = await previewTextRequest(context("Harbor Dental"), {
      phone: "+15555550123",
      standToken: TOKEN,
      messageTemplate: template,
    });
    expect(preview.segments).toBe(2);
  });

  it("shows when the business's own name makes the message UCS-2", async () => {
    const { previewTextRequest } = await import("@/lib/server/sms/text-request-service");
    const preview = await previewTextRequest(context("Joe’s Diner"), {
      phone: "+15555550123",
      standToken: TOKEN,
    });
    expect(preview.encoding).toBe("ucs2");
    expect(preview.body.startsWith("Joe’s Diner: ")).toBe(true);
  });

  it("schedules, reserves and stores exactly the previewed body", async () => {
    const { previewTextRequest, scheduleTextRequest } = await import(
      "@/lib/server/sms/text-request-service"
    );
    const { decrypt } = await import("@/lib/server/crypto");
    const input = { phone: "+15555550123", standToken: TOKEN, messageTemplate: "See you soon 🙂 {{link}}" };

    const preview = await previewTextRequest(context("Harbor Dental"), input);
    await scheduleTextRequest(context("Harbor Dental"), input, "req-1");

    const call = rpcCalls.find(({ name }) => name === "rpc_schedule_text_request");
    expect(decrypt(call?.args["p_message_encrypted"] as string)).toBe(preview.body);
    expect(call?.args["p_segments"]).toBe(preview.segments);
    expect(call?.args["p_encoding"]).toBe(preview.encoding);
    expect(call?.args["p_unit_count"]).toBe(preview.unitCount);
  });

  it("will not schedule a message that cannot name its business", async () => {
    const { scheduleTextRequest } = await import("@/lib/server/sms/text-request-service");
    await expect(
      scheduleTextRequest(context(null), { phone: "+15555550123", standToken: TOKEN }, "req-2"),
    ).rejects.toMatchObject({ status: 409 });
    expect(rpcCalls.some(({ name }) => name === "rpc_schedule_text_request")).toBe(false);
  });

  it("fails closed when the business name cannot be read", async () => {
    const { previewTextRequest } = await import("@/lib/server/sms/text-request-service");
    await expect(
      previewTextRequest(context(null, { message: "connection reset" }), {
        phone: "+15555550123",
        standToken: TOKEN,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("dispatch sends the stored body unchanged", () => {
  it("hands the provider the decrypted body with nothing appended", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/server/sms/dispatch.ts", "utf8");
    // The only body the provider is given is the decrypted stored one. A
    // footer added here would make every preview wrong.
    expect(source).toMatch(/const body = decrypt\(b\.message_encrypted\);/);
    expect(source).toMatch(/provider\.send\(\{ to, body, idempotencyKey/);
  });
});
