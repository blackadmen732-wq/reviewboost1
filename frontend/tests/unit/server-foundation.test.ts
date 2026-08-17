import { beforeAll, describe, expect, it, vi } from "vitest";

// The `server-only` guard throws outside a React Server Component build. It is
// exactly the protection we want in the app and exactly what has to be stubbed
// to unit-test the modules it protects.
vi.mock("server-only", () => ({}));

const KEY = Buffer.alloc(32, 7).toString("base64");

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.PUBLIC_FRONTEND_URL = "http://localhost:3000";
});

describe("token generation", () => {
  it("produces at least 256 bits of entropy, URL-safe", async () => {
    const { generateToken } = await import("@/lib/server/crypto");

    const token = generateToken();
    // base64url of 32 bytes. The token is the only thing authorising a write
    // into a business's data, so guessability is the whole security argument.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("never repeats", async () => {
    const { generateToken } = await import("@/lib/server/crypto");
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
  });
});

describe("keyed digests", () => {
  it("separates domains, so one token type cannot stand in for another", async () => {
    const { digestSessionToken, digestResponseToken } = await import("@/lib/server/crypto");

    const value = "identical-token-bytes";
    expect(digestSessionToken(value)).not.toBe(digestResponseToken(value));
  });

  it("is deterministic, so it can be looked up", async () => {
    const { digestStandToken } = await import("@/lib/server/crypto");
    expect(digestStandToken("abc")).toBe(digestStandToken("abc"));
  });

  it("does not contain the input", async () => {
    const { digestStandToken } = await import("@/lib/server/crypto");
    expect(digestStandToken("supersecrettoken")).not.toContain("supersecret");
  });
});

describe("client fingerprint", () => {
  it("differs per address and is not reversible", async () => {
    const { clientFingerprint } = await import("@/lib/server/crypto");

    const a = clientFingerprint("203.0.113.10", "Mozilla/5.0");
    const b = clientFingerprint("203.0.113.11", "Mozilla/5.0");

    expect(a).not.toBe(b);
    // The raw address must not survive into anything stored or logged.
    expect(a).not.toContain("203.0.113");
  });

  it("is stable within a day, so a limiter window means something", async () => {
    const { clientFingerprint } = await import("@/lib/server/crypto");
    expect(clientFingerprint("203.0.113.10", "UA")).toBe(clientFingerprint("203.0.113.10", "UA"));
  });
});

describe("encryption", () => {
  it("round-trips a note and leaves no plaintext in the ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/lib/server/crypto");

    const note = "The table was sticky and nobody came over for ten minutes.";
    const ciphertext = encrypt(note);

    expect(ciphertext).not.toBeNull();
    expect(ciphertext).not.toContain("sticky");
    expect(decrypt(ciphertext)).toBe(note);
  });

  it("uses a fresh IV, so the same note twice is not the same ciphertext", async () => {
    const { encrypt } = await import("@/lib/server/crypto");
    // Reusing an IV under one key is a catastrophic GCM failure.
    expect(encrypt("same text")).not.toBe(encrypt("same text"));
  });

  it("refuses a tampered ciphertext instead of returning garbage", async () => {
    const { encrypt, decrypt } = await import("@/lib/server/crypto");

    const ciphertext = encrypt("original") as string;
    const parts = ciphertext.split(":");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("evil").toString("base64")].join(":");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("stores nothing for an absent note", async () => {
    const { encrypt } = await import("@/lib/server/crypto");
    expect(encrypt(undefined)).toBeNull();
    expect(encrypt("")).toBeNull();
  });

  it("preserves Unicode exactly", async () => {
    const { encrypt, decrypt } = await import("@/lib/server/crypto");
    for (const value of ["José", "田中", "Ярослав", "great 🎉"]) {
      expect(decrypt(encrypt(value))).toBe(value);
    }
  });
});

describe("Google review URL validation", () => {
  it("agrees with the client validator on every case", async () => {
    // If the server were the looser of the two, it would serve a URL the client
    // rejects and the customer would see a dead flow with no diagnostic.
    const { isValidGoogleReviewUrl: server } = await import("@/lib/server/google-review-url");
    const { isValidatedGoogleReviewUrl: client } = await import("@/lib/security/google-review-url");

    const corpus = [
      "https://g.page/r/CdSAMPLE/review",
      "https://maps.app.goo.gl/abc123",
      "https://search.google.com/local/writereview?placeid=ChIJabc",
      "https://search.google.com/local/writereview",
      "https://www.google.com/maps/place/Cafe",
      "https://maps.google.com/maps/place/Cafe",
      "https://www.google.com/search?q=cafe",
      "https://evil.example/review",
      "https://google.evil.example/maps/",
      "https://www.google.com@evil.example/maps/",
      "https://user:pw@www.google.com/maps/",
      "http://g.page/r/abc/review",
      "javascript:alert(1)",
      "not a url",
      "",
    ];

    for (const value of corpus) {
      expect(server(value), value).toBe(client(value));
    }
  });

  it("rejects credentials in the authority", async () => {
    const { isValidGoogleReviewUrl } = await import("@/lib/server/google-review-url");
    expect(isValidGoogleReviewUrl("https://www.google.com@evil.example/maps/")).toBe(false);
  });
});

describe("stand URL generation", () => {
  it("builds against the frontend origin and cannot escape the path", async () => {
    const { standUrl } = await import("@/lib/server/google-review-url");

    expect(standUrl("https://app.example.com", "abc123")).toBe("https://app.example.com/q/abc123");

    const hostile = standUrl("https://app.example.com", "a/../../evil");
    // The separator is encoded, so the value stays one path segment.
    expect(new URL(hostile).pathname.split("/")).toHaveLength(3);
  });
});

describe("request canonicalisation", () => {
  it("treats a reordered body as the same request", async () => {
    const { canonicalJson } = await import("@/lib/server/validation");
    // A retrying client may serialise the same body in a different key order.
    // Calling that an idempotency conflict would break every retry.
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("treats an omitted optional field and an undefined one as identical", async () => {
    const { canonicalJson } = await import("@/lib/server/validation");
    expect(canonicalJson({ rating: 5 })).toBe(canonicalJson({ rating: 5, note: undefined }));
  });

  it("distinguishes genuinely different data", async () => {
    const { canonicalJson } = await import("@/lib/server/validation");
    expect(canonicalJson({ rating: 4 })).not.toBe(canonicalJson({ rating: 5 }));
  });

  it("keeps array order, because array order is meaningful", async () => {
    const { canonicalJson } = await import("@/lib/server/validation");
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});

describe("customer text normalisation", () => {
  it("never transliterates a name", async () => {
    const { normalizeCustomerText } = await import("@/lib/server/validation");
    expect(normalizeCustomerText("José")).toBe("José");
    expect(normalizeCustomerText("田中")).toBe("田中");
    expect(normalizeCustomerText("Ярослав")).toBe("Ярослав");
  });

  it("normalises to NFC so the same name compares equal however it was typed", async () => {
    const { normalizeCustomerText } = await import("@/lib/server/validation");
    const decomposed = "José";
    const precomposed = "José";
    expect(decomposed).not.toBe(precomposed);
    expect(normalizeCustomerText(decomposed)).toBe(normalizeCustomerText(precomposed));
  });

  it("keeps newlines, because a multi-line note is written on purpose", async () => {
    const { normalizeCustomerText } = await import("@/lib/server/validation");
    expect(normalizeCustomerText("one\ntwo")).toBe("one\ntwo");
  });

  it("strips control characters that could spoof how a note displays", async () => {
    const { normalizeCustomerText } = await import("@/lib/server/validation");
    expect(normalizeCustomerText("good service")).toBe("goodservice");
    expect(normalizeCustomerText("ab")).toBe("ab");
  });
});

describe("request schemas", () => {
  it("rejects contact and marketing fields outright", async () => {
    const { submitResponseSchema } = await import("@/lib/server/validation");

    // Rejected, not ignored. An endpoint that quietly discarded these would
    // still be one someone could be told to start sending them to.
    for (const extra of [
      { contactPhone: "+15555550123" },
      { contactEmail: "c@example.com" },
      { phone: "+15555550123" },
      { email: "c@example.com" },
      { consent: true },
      { marketingConsent: true },
      { organizationId: "00000000-0000-0000-0000-000000000000" },
      { standId: "00000000-0000-0000-0000-000000000000" },
      { reviewThreshold: 4 },
    ]) {
      const result = submitResponseSchema.safeParse({
        sessionId: "a".repeat(43),
        rating: 5,
        ...extra,
      });
      expect(result.success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("accepts every rating from one to five with no note", async () => {
    const { submitResponseSchema } = await import("@/lib/server/validation");

    for (const rating of [1, 2, 3, 4, 5]) {
      const result = submitResponseSchema.safeParse({ sessionId: "a".repeat(43), rating });
      expect(result.success, `rating ${rating}`).toBe(true);
    }
  });

  it("rejects a rating outside one to five", async () => {
    const { submitResponseSchema } = await import("@/lib/server/validation");

    for (const rating of [0, 6, -1, 2.5, Number.NaN]) {
      const result = submitResponseSchema.safeParse({ sessionId: "a".repeat(43), rating });
      expect(result.success, String(rating)).toBe(false);
    }
  });

  it("bounds a note by characters", async () => {
    const { submitResponseSchema } = await import("@/lib/server/validation");

    const base = { sessionId: "a".repeat(43), rating: 3 };
    expect(submitResponseSchema.safeParse({ ...base, note: "x".repeat(2000) }).success).toBe(true);
    expect(submitResponseSchema.safeParse({ ...base, note: "x".repeat(2001) }).success).toBe(false);
  });

  it("accepts a full-length note in any script, emoji included", async () => {
    const { submitResponseSchema, MAX_NOTE_LENGTH } = await import("@/lib/server/validation");

    const base = { sessionId: "a".repeat(43), rating: 3 };
    // A 2,000-character Japanese note is 6,000 bytes and entirely legitimate.
    // Setting the byte ceiling below that would reject real customers writing
    // in their own language.
    for (const filler of ["x", "é", "田", "🎉"]) {
      const note = filler.repeat(Math.floor(MAX_NOTE_LENGTH / filler.length));
      expect(submitResponseSchema.safeParse({ ...base, note }).success, filler).toBe(true);
    }
  });

  it("keeps the byte ceiling consistent with the character limit", async () => {
    const { MAX_NOTE_BYTES, MAX_NOTE_LENGTH, MAX_FIRST_NAME_BYTES, MAX_FIRST_NAME_LENGTH } =
      await import("@/lib/server/validation");

    // The worst case is 3 bytes per UTF-16 code unit, so the character limit is
    // always the binding one today. This asserts the pair stays consistent if
    // someone raises the character limit later.
    expect(MAX_NOTE_BYTES).toBe(MAX_NOTE_LENGTH * 3);
    expect(MAX_FIRST_NAME_BYTES).toBe(MAX_FIRST_NAME_LENGTH * 3);
    expect(Buffer.byteLength("田".repeat(MAX_NOTE_LENGTH), "utf8")).toBeLessThanOrEqual(MAX_NOTE_BYTES);
  });

  it("requires a first name on Team Praise", async () => {
    const { teamPraiseSchema } = await import("@/lib/server/validation");

    const base = { sessionId: "a".repeat(43), responseId: "b".repeat(43) };
    expect(teamPraiseSchema.safeParse(base).success).toBe(false);
    expect(teamPraiseSchema.safeParse({ ...base, firstName: "Sarah" }).success).toBe(true);
  });

  it("rejects an unsupported locale rather than guessing", async () => {
    const { createSessionSchema } = await import("@/lib/server/validation");
    expect(createSessionSchema.safeParse({ locale: "fr" }).success).toBe(false);
    expect(createSessionSchema.safeParse({ locale: "en" }).success).toBe(true);
  });
});

describe("log redaction", () => {
  it("removes secrets and customer content at every depth", async () => {
    const { __redactForTests } = await import("@/lib/server/logger");

    const redacted = __redactForTests({
      safe: "keep",
      note: "a private complaint",
      firstName: "José",
      sessionId: "capability-token",
      provider: { error: { supabaseServiceRoleKey: "sk-real-key", email: "c@example.com" } },
    }) as Record<string, unknown>;

    const serialised = JSON.stringify(redacted);

    expect(redacted["safe"]).toBe("keep");
    // The realistic leak is a nested provider error echoing content back, not
    // someone logging a secret directly.
    expect(serialised).not.toContain("private complaint");
    expect(serialised).not.toContain("José");
    expect(serialised).not.toContain("capability-token");
    expect(serialised).not.toContain("sk-real-key");
    expect(serialised).not.toContain("c@example.com");
  });
});

describe("environment validation", () => {
  it("refuses a non-HTTPS frontend origin in production", async () => {
    vi.resetModules();
    const previousUrl = process.env.PUBLIC_FRONTEND_URL;

    try {
      // stubEnv rather than direct assignment: NODE_ENV is typed read-only, and
      // unstubAllEnvs restores it without the test having to remember to.
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PUBLIC_FRONTEND_URL", "http://insecure.example.com");

      const { publicFrontendUrl } = await import("@/lib/server/env");
      expect(() => publicFrontendUrl()).toThrow(/HTTPS/);
    } finally {
      vi.unstubAllEnvs();
      process.env.PUBLIC_FRONTEND_URL = previousUrl;
      vi.resetModules();
    }
  });

  it("refuses a service-role key exposed as NEXT_PUBLIC", async () => {
    vi.resetModules();
    try {
      // That prefix inlines the value into the browser bundle, which would hand
      // every visitor a key that bypasses row level security.
      process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = "leaked";
      const { supabaseServiceRoleKey } = await import("@/lib/server/env");
      expect(() => supabaseServiceRoleKey()).toThrow(/NEXT_PUBLIC/);
    } finally {
      delete process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
      vi.resetModules();
    }
  });

  it("rejects an encryption key that is not 32 bytes", async () => {
    vi.resetModules();
    const previous = process.env.CUSTOMER_NOTE_ENCRYPTION_KEY;

    try {
      process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
      const { encryptionKey } = await import("@/lib/server/env");
      expect(() => encryptionKey()).toThrow(/32-byte/);
    } finally {
      process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = previous;
      vi.resetModules();
    }
  });
});
