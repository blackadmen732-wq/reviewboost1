import { classifyDevice } from '../domain/deviceFingerprint.js';
import { randomToken } from '../domain/crypto.js';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  canonicalJson,
  normalizeCustomerText,
} from '../domain/customerFlow.js';
import { isValidGoogleReviewUrl } from '../domain/googleReviewUrl.js';
import { conflict, notFound } from '../http/errors.js';
import * as repo from '../repositories/customerFlowRepository.js';
import {
  hashIdempotencyKey,
  hashIdempotencyRequest,
  hashPublicResponseToken,
  hashPublicSessionToken,
  pii,
  publicClientFingerprint,
} from './encryption.js';

/**
 * The anonymous customer flow.
 *
 * REVIEW INTEGRITY — the rule this whole module exists to keep
 * ------------------------------------------------------------
 * Nothing here branches on the rating. A 1 and a 5 take the same code path,
 * produce the same response shape, and receive the same Google opportunity.
 * The private note and Team Praise are additive: they are extra things a
 * customer may do, never a substitute for the public review.
 *
 * There is no threshold, no redirect decision, and no metric describing a
 * review as prevented or intercepted. If a future change makes any response
 * here depend on `rating`, that change is wrong.
 */

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long a claim may sit unfinished before another request may take it over.
 *
 * Only reachable if the process holding it died: the claim and the work commit
 * together, so an ordinary failure rolls the claim back with it.
 */
const IDEMPOTENCY_STALE_AFTER_SECONDS = 60;

export const OPERATION = Object.freeze({
  SESSION: 'session',
  RESPONSE: 'response',
  GOOGLE_CLICK: 'google-click',
  TEAM_PRAISE: 'team-praise',
});

/**
 * Unknown, inactive, and not-yet-serviceable stands share one response.
 *
 * Distinguishing them would confirm to anyone holding a guessed token that the
 * token was once real, and would leak whether a specific business is a
 * customer. There is no code path that reveals the difference.
 */
function inactiveLink() {
  return notFound('review_link_inactive', 'This review link is not active.');
}

/**
 * A stand can serve the public flow only if it resolves to a validated Google
 * review destination.
 *
 * The published contract makes `googleReviewUrl` required and non-nullable, and
 * the client re-validates it, so a stand without one cannot produce a usable
 * page. Failing here — identically to an unknown token — is better than serving
 * a context the client will reject with no explanation.
 */
function assertServiceable(stand) {
  if (!stand) throw inactiveLink();
  if (!isValidGoogleReviewUrl(stand.google_review_url)) throw inactiveLink();
  return stand;
}

// --------------------------------------------------------------- context ---

/**
 * Public presentation for one stand.
 *
 * Returns only what the page needs to render. No account id, no stand id, no
 * subscription state, no threshold — an anonymous caller that learned the
 * tenant could write unlimited fabricated feedback into it.
 */
export async function getContext(token) {
  return repo.withPublicStand(token, async (stand) => {
    assertServiceable(stand);

    return {
      business: { name: stand.business_name, logoUrl: null },
      // The legacy schema has no locations table. Null rather than substituting
      // the stand label, which is a placement, not a place.
      location: { name: null },
      googleReviewUrl: stand.google_review_url,
      supportedLocales: [...SUPPORTED_LOCALES],
      defaultLocale: DEFAULT_LOCALE,
    };
  });
}

// ----------------------------------------------------------- idempotency ---

/**
 * Run one public mutation exactly once per idempotency key.
 *
 * The claim, the domain write, and the recorded result commit in a single
 * transaction. That is what makes a network timeout safe: either all three
 * happened and the retry replays the stored result, or none did and the retry
 * performs the operation for the first time. There is no window in which a
 * session, response, click, or praise record exists without a result to replay.
 *
 * No external provider is called inside this transaction, so nothing holds it
 * open waiting on a third party.
 */
async function runIdempotent({ token, operation, method, route, idempotencyKey, request }, perform) {
  return repo.withPublicStand(token, async (stand, client) => {
    assertServiceable(stand);

    const scope = `stand:${token}`;
    const keyHash = hashIdempotencyKey(`${scope}|${operation}|${idempotencyKey}`);
    const requestHash = hashIdempotencyRequest(canonicalJson(request));

    const claim = await repo.claimIdempotency(client, {
      accountId: stand.account_id,
      scope,
      operation,
      method,
      route,
      keyHash,
      requestHash,
      ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
      staleAfterSeconds: IDEMPOTENCY_STALE_AFTER_SECONDS,
    });

    if (claim.outcome === 'conflict') {
      throw conflict(
        'idempotency_conflict',
        'This request was already made with different data. Use a new request key.',
      );
    }

    if (claim.outcome === 'in_progress') {
      throw conflict(
        'idempotency_in_progress',
        'An identical request is still being processed. Try again in a moment.',
      );
    }

    if (claim.outcome === 'replay') {
      return {
        // A replayed create is a 200, not a 201: nothing was created this time.
        status: claim.status === 201 ? 200 : claim.status,
        body: decodeStoredBody(claim.bodyEncrypted),
        replayed: true,
      };
    }

    const result = await perform(stand, client);

    await repo.completeIdempotency(client, {
      scope,
      operation,
      keyHash,
      status: result.status,
      bodyEncrypted: encodeStoredBody(result.body),
    });

    return { ...result, replayed: false };
  });
}

/**
 * The stored replay body is encrypted.
 *
 * It carries the opaque session and response tokens, which are keyed-hashed
 * everywhere else precisely so a database disclosure yields nothing usable.
 * Storing them in clear here would undo that.
 */
function encodeStoredBody(body) {
  return body === null || body === undefined ? null : pii.encrypt(JSON.stringify(body));
}

function decodeStoredBody(encrypted) {
  if (!encrypted) return null;
  const plaintext = pii.tryDecrypt(encrypted, null);
  return plaintext === null ? null : JSON.parse(plaintext);
}

// -------------------------------------------------------------- sessions ---

/**
 * Start an anonymous session and record one logical scan.
 *
 * The session token is 32 bytes of entropy and is stored only as a keyed HMAC.
 * It is a capability, not an identity: it says "this browser is partway through
 * the flow at this stand", and nothing about who the customer is.
 */
export async function createSession(
  token,
  { locale, idempotencyKey, ip, userAgent, route, method },
) {
  return runIdempotent(
    {
      token,
      operation: OPERATION.SESSION,
      method,
      route,
      idempotencyKey,
      request: { locale },
    },
    async (stand, client) => {
      const sessionToken = randomToken(32);
      const deviceType = classifyDevice(userAgent);
      const clientHash = publicClientFingerprint({ ip, userAgent });

      await repo.insertSession(client, {
        accountId: stand.account_id,
        standId: stand.stand_id,
        tokenHash: hashPublicSessionToken(sessionToken),
        locale,
        clientHash,
        ttlSeconds: SESSION_TTL_SECONDS,
      });

      // Bots are given a working session but never counted, so scan numbers
      // stay meaningful to the business paying for them.
      if (deviceType !== 'bot') {
        await repo.recordScan(client, {
          accountId: stand.account_id,
          standId: stand.stand_id,
          clientHash,
          userAgent,
          deviceType,
        });
      }

      return { status: 201, body: { sessionId: sessionToken } };
    },
  );
}

// ------------------------------------------------------------- responses ---

/**
 * Store a rating and an optional private note.
 *
 * Every rating from 1 to 5 is stored, and the note is optional for all of them.
 * The response is the same shape whichever rating was chosen.
 */
export async function submitResponse(
  token,
  { sessionId, rating, note, idempotencyKey, route, method },
) {
  return runIdempotent(
    {
      token,
      operation: OPERATION.RESPONSE,
      method,
      route,
      idempotencyKey,
      request: { sessionId, rating, note },
    },
    async (stand, client) => {
      const session = await repo.findSession(client, {
        standId: stand.stand_id,
        tokenHash: hashPublicSessionToken(sessionId),
      });

      // A session issued at one stand cannot be used at another: the lookup is
      // scoped to the stand, so a mismatch is simply not found.
      if (!session) throw notFound('session_not_found', 'This session is no longer available.');

      if (new Date(session.expires_at).getTime() <= Date.now()) {
        throw notFound('session_expired', 'This session has expired. Please scan the code again.');
      }

      if (await repo.responseExistsForSession(client, session.id)) {
        throw conflict(
          'response_already_submitted',
          'A response has already been recorded for this session.',
        );
      }

      const responseToken = randomToken(32);
      const trimmedNote = normalizeCustomerText(note);

      await repo.insertResponse(client, {
        accountId: stand.account_id,
        standId: stand.stand_id,
        sessionId: session.id,
        tokenHash: hashPublicResponseToken(responseToken),
        rating,
        noteEncrypted: trimmedNote ? pii.encrypt(trimmedNote) : null,
      });

      return { status: 201, body: { responseId: responseToken } };
    },
  );
}

// ---------------------------------------------------------- google click ---

/**
 * Record that the customer selected the Google action.
 *
 * That is the entire claim. It is not evidence that a review was written,
 * submitted, or published, and no downstream feature may present it as such —
 * ReviewBoost cannot see what a customer does on Google.
 *
 * Deduplicated per response, so a customer who taps twice produces one record.
 */
export async function recordGoogleClick(
  token,
  { sessionId, responseId, idempotencyKey, route, method },
) {
  return runIdempotent(
    {
      token,
      operation: OPERATION.GOOGLE_CLICK,
      method,
      route,
      idempotencyKey,
      request: { sessionId, responseId },
    },
    async (stand, client) => {
      const response = await requireResponse(client, stand, sessionId, responseId);

      await repo.recordGoogleClick(client, {
        accountId: stand.account_id,
        responseId: response.id,
      });

      return { status: 204, body: null };
    },
  );
}

// ------------------------------------------------------------ team praise --

/**
 * Store praise for a colleague.
 *
 * The name and note are encrypted at rest and stored unmatched. ReviewBoost
 * never guesses which employee the customer meant — matching is a decision a
 * human makes later, with the rating deliberately out of view.
 */
export async function submitTeamPraise(
  token,
  { sessionId, responseId, firstName, note, idempotencyKey, route, method },
) {
  return runIdempotent(
    {
      token,
      operation: OPERATION.TEAM_PRAISE,
      method,
      route,
      idempotencyKey,
      request: { sessionId, responseId, firstName, note },
    },
    async (stand, client) => {
      const response = await requireResponse(client, stand, sessionId, responseId);

      if (await repo.teamPraiseExistsForResponse(client, response.id)) {
        throw conflict(
          'team_praise_already_submitted',
          'Praise has already been recorded for this response.',
        );
      }

      const name = normalizeCustomerText(firstName);
      const praiseNote = normalizeCustomerText(note);

      const praiseId = await repo.insertTeamPraise(client, {
        accountId: stand.account_id,
        standId: stand.stand_id,
        responseId: response.id,
        firstNameEncrypted: pii.encrypt(name),
        noteEncrypted: praiseNote ? pii.encrypt(praiseNote) : null,
      });

      // The praise id is an internal UUID and is safe to return: unlike the
      // session and response tokens it authorises nothing.
      return { status: 201, body: { teamPraiseId: praiseId } };
    },
  );
}

/**
 * Resolve the response a follow-up action refers to.
 *
 * Stand, session, and response must all agree. A response token on its own is
 * not enough — that is what stops one leaked token being replayed against a
 * different session or a different business.
 */
async function requireResponse(client, stand, sessionId, responseId) {
  const response = await repo.findResponse(client, {
    standId: stand.stand_id,
    sessionTokenHash: hashPublicSessionToken(sessionId),
    responseTokenHash: hashPublicResponseToken(responseId),
  });

  if (!response) throw notFound('response_not_found', 'This response is no longer available.');
  return response;
}
