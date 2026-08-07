import 'dotenv/config';

/**
 * Strict, fail-fast configuration.
 *
 * Every value the application depends on is validated once, here, at boot. A
 * process that starts is a process that is correctly configured — there are no
 * `process.env` reads anywhere else in the codebase.
 *
 * The bias throughout is to refuse to start rather than to start in a subtly
 * wrong state. A server that boots with an unverifiable webhook secret or a
 * placeholder JWT key is worse than one that does not boot at all: the failure
 * surfaces later, in production, as silence.
 */

const NODE_ENVS = ['development', 'test', 'production'];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// ------------------------------------------------------------- parsers ----

function required(name, value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ConfigError(`${name} is required.`);
  }
  return String(value).trim();
}

function optional(value, fallback = null) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
}

function integer(name, value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

/** Strict, because "TRUE", "1", and "yes" each mean someone guessed. */
function boolean(name, value, fallback) {
  if (value === undefined || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new ConfigError(`${name} must be exactly "true" or "false".`);
}

function url(name, value, { requireHttps = false, allowEmpty = false } = {}) {
  const raw = optional(value);
  if (!raw) {
    if (allowEmpty) return null;
    throw new ConfigError(`${name} is required.`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL, e.g. https://api.example.com`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ConfigError(`${name} must use HTTP or HTTPS.`);
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new ConfigError(`${name} must use HTTPS in production.`);
  }

  // Trailing slashes are stripped so callers can concatenate paths safely.
  return raw.replace(/\/+$/, '');
}

function base64Key(name, value, byteLength) {
  const raw = required(name, value);
  if (Buffer.from(raw, 'base64').length !== byteLength) {
    throw new ConfigError(
      `${name} must be a base64-encoded ${byteLength}-byte key. ` +
        `Generate one with: openssl rand -base64 ${byteLength}`,
    );
  }
  return raw;
}

function origins(name, value, isProduction) {
  const list = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parsed = url(name, entry, { requireHttps: isProduction });
      const { origin, pathname, search, hash } = new URL(parsed);
      if (pathname !== '/' || search || hash) {
        throw new ConfigError(`${name} entries must be scheme://host[:port] only.`);
      }
      return origin;
    });

  if (isProduction && list.length === 0) {
    throw new ConfigError(`${name} must list at least one origin in production.`);
  }

  // Localhost is convenient in development and dangerous in production: a page
  // served from localhost would gain a browser-trusted path to the live API.
  const devDefaults = ['http://localhost:5173', 'http://localhost:5174'];
  return [...new Set(isProduction ? list : [...devDefaults, ...list])];
}

/**
 * The public origin customer review links are built against.
 *
 * `PUBLIC_FRONTEND_URL` if set, otherwise `PUBLIC_APP_URL` — the frontend is
 * where /q/:token is served, and the two are the same host in every deployment
 * so far. Production must have one of them: falling back to a localhost default
 * would print QR codes that resolve to nothing on a customer's phone, and would
 * do it silently.
 */
function frontendOrigin(env, isProduction) {
  const explicit = url('PUBLIC_FRONTEND_URL', env.PUBLIC_FRONTEND_URL, {
    requireHttps: isProduction,
    allowEmpty: true,
  });
  if (explicit) return explicit;

  const app = url('PUBLIC_APP_URL', env.PUBLIC_APP_URL, {
    requireHttps: isProduction,
    allowEmpty: true,
  });
  if (app) return app;

  if (isProduction) {
    throw new ConfigError(
      'PUBLIC_FRONTEND_URL (or PUBLIC_APP_URL) is required in production. It is the origin ' +
        'printed into every QR code, and a stand printed against the wrong origin cannot be ' +
        'recalled.',
    );
  }

  // Development only, and stated rather than assumed.
  return 'http://localhost:3000';
}

/** Credentials that only make sense as a complete set. */
function credentialGroup(name, values) {
  const provided = values.filter((value) => optional(value) !== null);
  if (provided.length > 0 && provided.length !== values.length) {
    throw new ConfigError(`${name} configuration is incomplete — provide all values or none.`);
  }
  return provided.length === values.length;
}

// -------------------------------------------------------------- loader ----

export function loadConfig(env = process.env) {
  const nodeEnv = optional(env.NODE_ENV, 'development');
  if (!NODE_ENVS.includes(nodeEnv)) {
    throw new ConfigError(`NODE_ENV must be one of: ${NODE_ENVS.join(', ')}.`);
  }

  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  // ---- Secrets -------------------------------------------------------------
  const jwtSecret = required('JWT_SECRET', env.JWT_SECRET);
  if (jwtSecret.length < 32) {
    throw new ConfigError(
      'JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48',
    );
  }
  if (/^(change|replace|your|example|secret|super_secret|test)/i.test(jwtSecret) && isProduction) {
    throw new ConfigError('JWT_SECRET still looks like a placeholder value.');
  }

  /**
   * Twilio.
   *
   * Two credential types with different jobs, and they are not interchangeable:
   *
   *   API Key (SK…) + Secret  Sending. Preferred: scoped, and revocable
   *                           without invalidating everything else.
   *   Auth Token              Verifying inbound webhook signatures. Twilio
   *                           signs callbacks with the account Auth Token; an
   *                           API Key secret cannot validate them.
   *
   * Running with only an API Key silently disables delivery receipts and STOP
   * handling — an opt-out that never registers is a legal problem, not a bug —
   * so real-SMS mode refuses to start without the Auth Token.
   */
  const twilioAccountSid = optional(env.TWILIO_ACCOUNT_SID, '');
  const twilioApiKeySid = optional(env.TWILIO_API_KEY_SID, '');
  const twilioApiKeySecret = optional(env.TWILIO_API_KEY_SECRET, '');
  const twilioAuthToken = optional(env.TWILIO_AUTH_TOKEN, '');
  const twilioFromNumber = optional(env.TWILIO_FROM_NUMBER, '');

  if (twilioAccountSid && !/^AC[0-9a-f]{32}$/i.test(twilioAccountSid)) {
    throw new ConfigError('TWILIO_ACCOUNT_SID must look like AC followed by 32 hex characters.');
  }
  if (twilioApiKeySid && !/^SK[0-9a-f]{32}$/i.test(twilioApiKeySid)) {
    throw new ConfigError('TWILIO_API_KEY_SID must look like SK followed by 32 hex characters.');
  }
  if (Boolean(twilioApiKeySid) !== Boolean(twilioApiKeySecret)) {
    throw new ConfigError('TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET must be set together.');
  }
  if (twilioFromNumber && !/^\+[1-9]\d{7,14}$/.test(twilioFromNumber)) {
    throw new ConfigError('TWILIO_FROM_NUMBER must be E.164, e.g. +15555550123');
  }

  const twilioUsesApiKey = Boolean(twilioApiKeySid && twilioApiKeySecret);
  // An API Key still needs the Account SID to know which account it acts on.
  const twilioCanSend =
    Boolean(twilioFromNumber) &&
    Boolean(twilioAccountSid) &&
    (twilioUsesApiKey || Boolean(twilioAuthToken));
  const twilioCanVerifyWebhooks = Boolean(twilioAuthToken);

  const stripeConfigured = credentialGroup('Stripe', [
    env.STRIPE_SECRET_KEY,
    env.STRIPE_WEBHOOK_SECRET,
    env.STRIPE_PRICE_ID,
  ]);

  const resendApiKey = optional(env.RESEND_API_KEY, '');
  if (resendApiKey && !resendApiKey.startsWith('re_')) {
    throw new ConfigError('RESEND_API_KEY must start with "re_".');
  }
  const emailFrom = optional(env.EMAIL_FROM, '');
  if (resendApiKey && !emailFrom) {
    throw new ConfigError('EMAIL_FROM is required when RESEND_API_KEY is set.');
  }
  const emailConfigured = Boolean(resendApiKey && emailFrom);

  const smsDryRun = boolean('SMS_DRY_RUN', env.SMS_DRY_RUN, !isProduction);

  if (!smsDryRun && !twilioCanSend) {
    throw new ConfigError(
      'Real SMS mode requires TWILIO_ACCOUNT_SID, TWILIO_FROM_NUMBER, and either ' +
        'TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN.',
    );
  }
  if (!smsDryRun && !twilioCanVerifyWebhooks) {
    throw new ConfigError(
      'Real SMS mode requires TWILIO_AUTH_TOKEN. Twilio signs inbound webhooks with the ' +
        'account Auth Token, so delivery receipts and STOP replies cannot be verified ' +
        'without it — opt-outs would silently stop working.',
    );
  }
  if (isProduction && !stripeConfigured) {
    throw new ConfigError('Production requires complete Stripe configuration.');
  }
  if (isProduction && !emailConfigured) {
    throw new ConfigError(
      'Production requires RESEND_API_KEY and EMAIL_FROM — password reset and email ' +
        'verification are unusable without a real mail provider.',
    );
  }

  const quietHoursStart = integer('QUIET_HOURS_START', env.QUIET_HOURS_START, 8, { min: 0, max: 23 });
  const quietHoursEnd = integer('QUIET_HOURS_END', env.QUIET_HOURS_END, 21, { min: 1, max: 24 });
  if (quietHoursEnd <= quietHoursStart) {
    throw new ConfigError('QUIET_HOURS_END must be later than QUIET_HOURS_START.');
  }

  return Object.freeze({
    nodeEnv,
    isProduction,
    isTest,
    port: integer('PORT', env.PORT, 4000, { max: 65535 }),
    logLevel: optional(env.LOG_LEVEL, isTest ? 'silent' : 'info'),

    // ---- Public URLs -------------------------------------------------------
    // PUBLIC_API_URL is what Twilio signs webhooks against. Behind a
    // TLS-terminating proxy the request Express sees is plain http, so
    // reconstructing the URL would never match the signature.
    publicApiUrl: url('PUBLIC_API_URL', env.PUBLIC_API_URL, {
      requireHttps: isProduction,
      allowEmpty: !isProduction,
    }),
    publicAppUrl: url('PUBLIC_APP_URL', env.PUBLIC_APP_URL, {
      requireHttps: isProduction,
      allowEmpty: !isProduction,
    }),
    // The origin printed into every QR code and written to every NFC tag.
    // Required in production and validated at boot, because a stand is a
    // physical object: a code printed against the wrong origin cannot be
    // recalled from the tables it is already sitting on.
    publicFrontendUrl: frontendOrigin(env, isProduction),
    corsOrigins: origins('CORS_ORIGINS', env.CORS_ORIGINS, isProduction),

    // ---- Data stores -------------------------------------------------------
    databaseUrl: required('DATABASE_URL', env.DATABASE_URL),
    databasePoolMax: integer('DATABASE_POOL_MAX', env.DATABASE_POOL_MAX, 10, { max: 200 }),
    databaseSsl: boolean('DATABASE_SSL', env.DATABASE_SSL, isProduction),
    redisUrl: required('REDIS_URL', env.REDIS_URL),

    // ---- Auth --------------------------------------------------------------
    jwtSecret,
    accessTokenTtlSeconds: integer('ACCESS_TOKEN_TTL_SECONDS', env.ACCESS_TOKEN_TTL_SECONDS, 900, {
      min: 60,
      max: 3600,
    }),
    refreshTokenTtlDays: integer('REFRESH_TOKEN_TTL_DAYS', env.REFRESH_TOKEN_TTL_DAYS, 30, {
      max: 365,
    }),
    // Cost 4 in tests keeps the suite fast; 12 everywhere that matters.
    bcryptRounds: integer('BCRYPT_ROUNDS', env.BCRYPT_ROUNDS, isTest ? 4 : 12, { min: 4, max: 15 }),
    cookieDomain: optional(env.COOKIE_DOMAIN),
    requireEmailVerification: boolean(
      'REQUIRE_EMAIL_VERIFICATION',
      env.REQUIRE_EMAIL_VERIFICATION,
      isProduction,
    ),
    loginLockoutThreshold: integer('LOGIN_LOCKOUT_THRESHOLD', env.LOGIN_LOCKOUT_THRESHOLD, 10, {
      min: 3,
      max: 100,
    }),
    loginLockoutMinutes: integer('LOGIN_LOCKOUT_MINUTES', env.LOGIN_LOCKOUT_MINUTES, 15, {
      max: 1440,
    }),
    registrationsPerHourPerIp: integer(
      'REGISTRATIONS_PER_HOUR_PER_IP',
      env.REGISTRATIONS_PER_HOUR_PER_IP,
      5,
      { max: 1000 },
    ),

    // ---- Encryption --------------------------------------------------------
    // Encrypts phone numbers, names, and feedback at rest, and keys the HMAC
    // lookup columns. Not rotatable without re-encrypting existing rows.
    piiEncryptionKey: base64Key('PII_ENCRYPTION_KEY', env.PII_ENCRYPTION_KEY, 32),

    // ---- Twilio ------------------------------------------------------------
    smsDryRun,
    twilioConfigured: twilioCanSend,
    twilioCanSend,
    twilioCanVerifyWebhooks,
    twilioUsesApiKey,
    twilioAccountSid,
    twilioApiKeySid,
    twilioApiKeySecret,
    twilioAuthToken,
    twilioFromNumber,

    // ---- Stripe ------------------------------------------------------------
    stripeConfigured,
    stripeSecretKey: optional(env.STRIPE_SECRET_KEY, ''),
    stripeWebhookSecret: optional(env.STRIPE_WEBHOOK_SECRET, ''),
    stripePriceId: optional(env.STRIPE_PRICE_ID, ''),
    trialDays: integer('TRIAL_DAYS', env.TRIAL_DAYS, 14, { min: 0, max: 90 }),

    // ---- Email -------------------------------------------------------------
    emailConfigured,
    resendApiKey,
    emailFrom,
    emailReplyTo: optional(env.EMAIL_REPLY_TO, ''),

    // ---- Messaging policy --------------------------------------------------
    // Integer cents charged per SMS segment. Money is never a float anywhere.
    smsPricePerSegmentCents: integer(
      'SMS_PRICE_PER_SEGMENT_CENTS',
      env.SMS_PRICE_PER_SEGMENT_CENTS,
      2,
      { min: 0, max: 1000 },
    ),
    duplicateWindowDays: integer('DUPLICATE_WINDOW_DAYS', env.DUPLICATE_WINDOW_DAYS, 30, {
      max: 365,
    }),
    maxRecipientsPerCampaign: integer(
      'MAX_RECIPIENTS_PER_CAMPAIGN',
      env.MAX_RECIPIENTS_PER_CAMPAIGN,
      5000,
      { max: 50000 },
    ),
    // TCPA quiet hours, evaluated in each recipient's local timezone.
    quietHoursStart,
    quietHoursEnd,

    // ---- Workers -----------------------------------------------------------
    smsWorkerConcurrency: integer('SMS_WORKER_CONCURRENCY', env.SMS_WORKER_CONCURRENCY, 10, {
      max: 200,
    }),
    // Keep at or below your Twilio per-number throughput or carriers filter you.
    smsPerSecondLimit: integer('SMS_PER_SECOND_LIMIT', env.SMS_PER_SECOND_LIMIT, 10, { max: 1000 }),
    requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', env.REQUEST_TIMEOUT_MS, 30_000, {
      min: 1000,
      max: 120_000,
    }),
  });
}

export const config = loadConfig();
