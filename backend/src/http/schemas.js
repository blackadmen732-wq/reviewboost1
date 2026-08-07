import { z } from 'zod';

import {
  MAX_FIRST_NAME_BYTES,
  MAX_FIRST_NAME_LENGTH,
  MAX_NOTE_BYTES,
  MAX_NOTE_LENGTH,
  SUPPORTED_LOCALES,
  byteLength,
} from '../domain/customerFlow.js';

/**
 * Request schemas.
 *
 * Validation happens once, at the edge. Everything below this layer can assume
 * its input is well-formed and correctly typed, which is what lets the
 * repositories stay free of defensive checks.
 */

const email = z.string().trim().toLowerCase().email().max(200);

// Deliberately no Gmail-style canonicalisation: stripping dots would collapse
// genuinely distinct addresses into one account.
const password = z.string().min(12, 'Password must be at least 12 characters.').max(200);

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), 'Must be an http(s) URL.');

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex colour like #1A2B3C.');

const timezone = z
  .string()
  .max(60)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid IANA timezone.');

// ------------------------------------------------------------------ auth --

export const registerSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  email,
  password,
  fullName: z.string().trim().max(120).optional(),
  googleReviewUrl: httpUrl,
  timezone: timezone.optional(),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: password,
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const switchAccountSchema = z.object({ accountId: z.string().uuid() });

// TOTP codes are six digits; recovery codes are hyphenated hex groups.
export const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(40) });

export const mfaChallengeSchema = z.object({
  challengeToken: z.string().min(20).max(2000),
  code: z.string().trim().min(6).max(40),
});

// ------------------------------------------------------------- campaigns --

export const recipientSchema = z.object({
  phone: z.string().trim().min(5).max(32),
  name: z.string().trim().max(80).optional(),
  consent: z.boolean().optional().default(false),
  consentSource: z.string().trim().max(80).optional(),
  consentAt: z.string().datetime().optional(),
  timezone: timezone.optional(),
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  messageTemplate: z.string().trim().min(1).max(1000),
  reviewLink: httpUrl,
  // Bounded here as well as in config, so an oversized payload is rejected
  // before it is parsed into memory.
  recipients: z.array(recipientSchema).min(1).max(5000),
  requireConsent: z.boolean().optional().default(true),
  scheduledAt: z.string().datetime().optional(),
});

export const estimateCampaignSchema = z.object({
  messageTemplate: z.string().trim().min(1).max(1000),
  reviewLink: httpUrl.optional(),
  recipients: z.array(recipientSchema).min(1).max(5000),
});

export const previewSchema = z.object({
  messageTemplate: z.string().trim().min(1).max(1000),
  reviewLink: httpUrl.optional(),
  sampleName: z.string().trim().max(80).optional(),
});

// -------------------------------------------------------------------- QR --

export const createStandSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  destinationUrl: httpUrl.optional(),
  primaryColor: hexColor.optional(),
  backgroundColor: hexColor.optional(),
});

export const updateStandSchema = createStandSchema.extend({
  isActive: z.boolean().optional(),
});

export const publicIdSchema = z.object({
  publicId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid QR code.'),
});

// ------------------------------------------------------- customer flow -----
//
// The anonymous flow at /api/v1/public/q/:token. Every schema below is
// `.strict()`, which is the published contract's `additionalProperties: false`
// enforced server-side: an unrecognised field is rejected rather than ignored.
// That is what makes "the public endpoints do not accept a phone number, an
// email address, a marketing consent flag, or a tenant id" a property the code
// has rather than a promise the documentation makes.

const customerNote = z
  .string()
  .max(MAX_NOTE_LENGTH)
  // Character limits count UTF-16 code units, so 2,000 characters of emoji is
  // several times 2,000 bytes. The storage layer cares about bytes.
  .refine((value) => byteLength(value) <= MAX_NOTE_BYTES, 'Note is too large.');

const opaqueToken = z.string().regex(/^[A-Za-z0-9_-]{16,160}$/, 'Invalid token.');

export const publicTokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, 'Invalid review link.'),
});

/** Contract: `Idempotency-Key`, 16 to 128 characters, required on every mutation. */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{16,128}$/, 'Idempotency-Key must be 16-128 URL-safe characters.');

export const createSessionSchema = z
  .object({ locale: z.enum(SUPPORTED_LOCALES) })
  .strict();

export const submitResponseSchema = z
  .object({
    sessionId: opaqueToken,
    // Every rating is accepted and stored. Nothing downstream branches on it.
    rating: z.number().int().min(1).max(5),
    // Optional for every rating, including 4 and 5.
    note: customerNote.optional(),
  })
  .strict();

export const googleClickSchema = z
  .object({ sessionId: opaqueToken, responseId: opaqueToken })
  .strict();

export const teamPraiseSchema = z
  .object({
    sessionId: opaqueToken,
    responseId: opaqueToken,
    // Unicode is accepted as written. Names are not transliterated.
    firstName: z
      .string()
      .min(1)
      .max(MAX_FIRST_NAME_LENGTH)
      .refine((value) => byteLength(value) <= MAX_FIRST_NAME_BYTES, 'Name is too large.'),
    note: customerNote.optional(),
  })
  .strict();

// --------------------------------------------------------------- account --

export const inviteMemberSchema = z.object({
  email,
  role: z.enum(['admin', 'member', 'viewer']),
});

export const updateAccountSchema = z.object({
  businessName: z.string().trim().min(1).max(120).optional(),
  googleReviewUrl: httpUrl.optional(),
  timezone: timezone.optional(),
});

export const ipAllowlistSchema = z.object({
  cidr: z
    .string()
    .trim()
    .max(64)
    .refine(
      (value) =>
        /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(value) ||
        /^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(value),
      'Must be an IP address or CIDR range, e.g. 203.0.113.0/24',
    ),
  label: z.string().trim().max(80).optional(),
});

export const toggleAllowlistSchema = z.object({ enabled: z.boolean() });

// ---------------------------------------------------------------- shared --

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// Query params arrive as strings. Coercing with a bare Number() turns "abc"
// into NaN and passes it straight through to a renderer or a query.
export const qrSizeSchema = z.object({
  size: z.coerce.number().int().min(128).max(2048).optional().default(512),
});

export const analyticsRangeSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

export const uuidParamSchema = (key) => z.object({ [key]: z.string().uuid() });
