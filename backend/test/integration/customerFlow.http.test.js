import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import request from 'supertest';

import { buildApp, ignoreInfrastructureNoise, teardown } from '../helpers/testApp.js';

/**
 * HTTP contract for the anonymous customer flow.
 *
 * Runs with no Postgres, like the rest of this suite. That bounds what can be
 * proven here to everything above the data layer — routing, validation,
 * headers, CORS, CSRF exemption, and the error envelope — which is exactly the
 * part that must hold on every push without standing up infrastructure.
 *
 * The data-path properties (idempotent replay, cross-tenant isolation,
 * encryption at rest, one response per session) live in database.test.js and
 * need a real database. They are not asserted here, and this file must not be
 * read as covering them.
 */

const SESSION_ID = 'a'.repeat(43);
const RESPONSE_ID = 'b'.repeat(43);

let counter = 0;
let app;

/**
 * A fresh, well-formed stand token per call.
 *
 * The public limiters are keyed per stand and per client fingerprint, and they
 * are left at their production budgets here — a suite that had to switch them
 * off would stop proving they are wired up at all. Varying the token and the
 * user agent keeps each assertion measuring what it says it measures instead of
 * racing the limiter.
 */
function link() {
  counter += 1;
  return `/api/v1/public/q/tst${String(counter).padStart(9, '0')}`;
}

function agent() {
  counter += 1;
  return `contract-test/${counter}`;
}

function get(path) {
  return request(app).get(path).set('User-Agent', agent());
}

function post(path, body, headers = {}) {
  let call = request(app).post(path).set('User-Agent', agent());
  for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
  return call.send(body);
}

function key(operation) {
  counter += 1;
  return `rb_${operation}_00000000-1111-2222-3333-${String(counter).padStart(12, '0')}`;
}

before(async () => {
  process.on('unhandledRejection', ignoreInfrastructureNoise);
  app = await buildApp();
});

after(async () => {
  await teardown();
  process.off('unhandledRejection', ignoreInfrastructureNoise);
});

describe('customer flow routing', () => {
  it('mounts all five endpoints', async () => {
    // Any error other than "no route" proves the route exists. With no database
    // the handlers cannot complete, which is the point of the split above.
    const base = link();

    const calls = [
      get(base),
      post(`${base}/sessions`, { locale: 'en' }, { 'Idempotency-Key': key('session') }),
      post(
        `${base}/responses`,
        { sessionId: SESSION_ID, rating: 3 },
        { 'Idempotency-Key': key('response') },
      ),
      post(
        `${base}/google-click`,
        { sessionId: SESSION_ID, responseId: RESPONSE_ID },
        { 'Idempotency-Key': key('google-click') },
      ),
      post(
        `${base}/team-praise`,
        { sessionId: SESSION_ID, responseId: RESPONSE_ID, firstName: 'Sarah' },
        { 'Idempotency-Key': key('team-praise') },
      ),
    ];

    for (const response of await Promise.all(calls)) {
      assert.notEqual(response.body?.error?.code, 'not_found');
      assert.notEqual(response.status, 404);
    }
  });

  it('marks every customer response uncacheable', async () => {
    const response = await get(link());
    assert.equal(response.headers['cache-control'], 'no-store');
  });
});

describe('review link tokens', () => {
  it('rejects a malformed token before any lookup', async () => {
    const response = await get('/api/v1/public/q/not-a-valid-token!!').expect(400);
    assert.equal(response.body.error.code, 'validation_failed');
  });

  it('never echoes a tenant identifier back to an anonymous caller', async () => {
    // Anyone who learned the account id could write unlimited fabricated
    // feedback into that business.
    const base = link();
    const responses = await Promise.all([
      get(base),
      get('/api/v1/public/q/not-a-valid-token!!'),
      post(`${base}/sessions`, { locale: 'en' }),
    ]);

    for (const response of responses) {
      const body = JSON.stringify(response.body);
      assert.doesNotMatch(body, /account_?id/i);
      assert.doesNotMatch(body, /stand_?id/i);
      assert.doesNotMatch(body, /threshold/i);
    }
  });
});

describe('idempotency key handling', () => {
  it('requires the header on every mutation', async () => {
    const base = link();
    const mutations = [
      [`${base}/sessions`, { locale: 'en' }],
      [`${base}/responses`, { sessionId: SESSION_ID, rating: 5 }],
      [`${base}/google-click`, { sessionId: SESSION_ID, responseId: RESPONSE_ID }],
      [`${base}/team-praise`, { sessionId: SESSION_ID, responseId: RESPONSE_ID, firstName: 'Sam' }],
    ];

    for (const [path, body] of mutations) {
      const response = await post(path, body).expect(400);
      assert.equal(response.body.error.code, 'idempotency_key_required', path);
    }
  });

  it('rejects a key too short to be worth anything', async () => {
    const response = await post(
      `${link()}/sessions`,
      { locale: 'en' },
      { 'Idempotency-Key': 'short' },
    ).expect(400);

    assert.equal(response.body.error.code, 'idempotency_key_required');
  });

  it('names the header in the field errors, so a client can fix it', async () => {
    const response = await post(`${link()}/sessions`, { locale: 'en' }).expect(400);
    assert.equal(response.body.error.details[0].field, 'Idempotency-Key');
  });

  it('accepts the key format the frontend generates', async () => {
    const response = await post(
      `${link()}/sessions`,
      { locale: 'en' },
      { 'Idempotency-Key': 'rb_session_9f8e7d6c-5b4a-3210-9876-543210fedcba' },
    );

    assert.notEqual(response.body?.error?.code, 'idempotency_key_required');
  });
});

describe('request validation', () => {
  it('handles every rating from one to five identically', async () => {
    // The rule the whole feature rests on: nothing about how a rating is
    // handled may depend on its value.
    const base = link();

    const outcomes = await Promise.all(
      [1, 2, 3, 4, 5].map((rating) =>
        post(
          `${base}/responses`,
          { sessionId: SESSION_ID, rating },
          { 'Idempotency-Key': key('response') },
        ),
      ),
    );

    const shapes = outcomes.map((response) => ({
      status: response.status,
      code: response.body?.error?.code,
      keys: Object.keys(response.body ?? {}).sort().join(','),
    }));

    for (const shape of shapes) assert.deepEqual(shape, shapes[0]);
    // And none was turned away for being the wrong rating.
    assert.notEqual(shapes[0].code, 'validation_failed');
  });

  it('rejects a rating outside one to five', async () => {
    for (const rating of [0, 6, -1, 2.5]) {
      const response = await post(
        `${link()}/responses`,
        { sessionId: SESSION_ID, rating },
        { 'Idempotency-Key': key('response') },
      ).expect(400);

      assert.equal(response.body.error.code, 'validation_failed', String(rating));
    }
  });

  it('treats the note as optional for every rating', async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const response = await post(
        `${link()}/responses`,
        { sessionId: SESSION_ID, rating },
        { 'Idempotency-Key': key('response') },
      );

      assert.notEqual(response.status, 400, `rating ${rating} demanded a note`);
    }
  });

  it('rejects contact and marketing fields outright', async () => {
    // Rejected, not ignored. The customer flow collects no way to contact the
    // customer, and an endpoint that quietly discarded these would still be an
    // endpoint someone could be told to start sending them to.
    const rejected = [
      { contactPhone: '+15555550123' },
      { contactEmail: 'customer@example.com' },
      { phone: '+15555550123' },
      { email: 'customer@example.com' },
      { consent: true },
      { marketingConsent: true },
      { accountId: '00000000-0000-0000-0000-000000000000' },
      { standId: '00000000-0000-0000-0000-000000000000' },
      { reviewThreshold: 4 },
    ];

    for (const extra of rejected) {
      const response = await post(
        `${link()}/responses`,
        { sessionId: SESSION_ID, rating: 5, ...extra },
        { 'Idempotency-Key': key('response') },
      ).expect(400);

      assert.equal(response.body.error.code, 'validation_failed', JSON.stringify(extra));
    }
  });

  it('rejects an unsupported locale rather than guessing one', async () => {
    const response = await post(
      `${link()}/sessions`,
      { locale: 'fr' },
      { 'Idempotency-Key': key('session') },
    ).expect(400);

    assert.equal(response.body.error.code, 'validation_failed');
  });

  it('bounds the note and the name', async () => {
    const tooLongNote = await post(
      `${link()}/responses`,
      { sessionId: SESSION_ID, rating: 4, note: 'x'.repeat(2001) },
      { 'Idempotency-Key': key('response') },
    ).expect(400);
    assert.equal(tooLongNote.body.error.code, 'validation_failed');

    const tooLongName = await post(
      `${link()}/team-praise`,
      { sessionId: SESSION_ID, responseId: RESPONSE_ID, firstName: 'x'.repeat(81) },
      { 'Idempotency-Key': key('team-praise') },
    ).expect(400);
    assert.equal(tooLongName.body.error.code, 'validation_failed');
  });

  it('requires a first name on Team Praise', async () => {
    const response = await post(
      `${link()}/team-praise`,
      { sessionId: SESSION_ID, responseId: RESPONSE_ID },
      { 'Idempotency-Key': key('team-praise') },
    ).expect(400);

    assert.equal(response.body.error.code, 'validation_failed');
  });
});

describe('error envelope', () => {
  it('always carries a code, a message, and a request id', async () => {
    const response = await get('/api/v1/public/q/bad!token').expect(400);

    assert.equal(typeof response.body.error.code, 'string');
    assert.equal(typeof response.body.error.message, 'string');
    assert.equal(typeof response.body.requestId, 'string');
    assert.deepEqual(Object.keys(response.body).sort(), ['error', 'requestId']);
  });

  it('never leaks internals into a customer-facing failure', async () => {
    const base = link();
    const responses = await Promise.all([
      get(base),
      post(
        `${base}/responses`,
        { sessionId: SESSION_ID, rating: 3 },
        { 'Idempotency-Key': key('response') },
      ),
    ]);

    for (const response of responses) {
      const body = JSON.stringify(response.body);
      assert.doesNotMatch(body, /\/home\/|node_modules|at Object|\.js:\d+/);
      assert.doesNotMatch(body, /ECONNREFUSED|postgres|relation |syntax error/i);
    }
  });

  it('never answers a customer mutation with an undocumented 202', async () => {
    // The client rejects 202 outright, because there is no status contract
    // behind it. A handler that started returning one would silently break the
    // flow for every customer.
    const base = link();
    const responses = await Promise.all([
      post(`${base}/sessions`, { locale: 'en' }, { 'Idempotency-Key': key('session') }),
      post(
        `${base}/responses`,
        { sessionId: SESSION_ID, rating: 1 },
        { 'Idempotency-Key': key('response') },
      ),
    ]);

    for (const response of responses) assert.notEqual(response.status, 202);
  });
});

describe('CORS', () => {
  const origin = 'http://localhost:5173';

  it('permits Idempotency-Key on preflight, without which nothing works', async () => {
    const response = await request(app)
      .options(`${link()}/responses`)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key');

    const allowed = String(response.headers['access-control-allow-headers'] ?? '').toLowerCase();
    assert.match(allowed, /idempotency-key/);
    assert.match(allowed, /content-type/);
  });

  it('still permits the dashboard headers', async () => {
    const response = await request(app)
      .options('/api/qr/stands')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

    const allowed = String(response.headers['access-control-allow-headers'] ?? '').toLowerCase();
    assert.match(allowed, /authorization/);
    assert.match(allowed, /x-csrf-token/);
  });
});

describe('CSRF exemption for the anonymous flow', () => {
  it('does not demand a CSRF token when a dashboard session cookie is present', async () => {
    // An owner testing their own QR code is signed in, so their cookies ride
    // along. Without the exemption the public flow returns 403 for exactly the
    // person most likely to try it.
    const response = await post(
      `${link()}/sessions`,
      { locale: 'en' },
      { 'Idempotency-Key': key('session'), Cookie: 'rb_access=whatever; rb_refresh=whatever' },
    );

    assert.notEqual(response.status, 403);
    assert.notEqual(response.body?.error?.code, 'csrf_failed');
  });

  it('still demands one on an authenticated route', async () => {
    const response = await request(app)
      .patch('/api/dashboard/account')
      .set('Cookie', ['rb_access=whatever'])
      .send({ businessName: 'New Name' });

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'csrf_failed');
  });
});

describe('the legacy rating gate is unreachable', () => {
  const legacyToken = 'abcdefgh1234';

  it('answers the old rating endpoint with 410, not a routing decision', async () => {
    const response = await post(`/q/${legacyToken}/rating`, { rating: 5 }).expect(410);

    assert.equal(response.body.error.code, 'endpoint_removed');
    // Above all: no rating-dependent destination comes back.
    assert.equal(response.body.action, undefined);
    assert.equal(response.body.reviewUrl, undefined);
  });

  it('refuses it for a low rating too, so nothing can be captured privately', async () => {
    const response = await post(`/q/${legacyToken}/rating`, {
      rating: 1,
      feedbackText: 'bad',
      contactPhone: '+15555550123',
    }).expect(410);

    assert.equal(response.body.error.code, 'endpoint_removed');
  });

  it('forwards an old printed code to the frontend flow instead of rendering a gate', async () => {
    const response = await get(`/q/${legacyToken}`);

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `http://localhost:5173/q/${legacyToken}`);
    // The old server-rendered star gate is gone.
    assert.doesNotMatch(String(response.text ?? ''), /How did we do/i);
  });
});

describe('stand URLs point at the customer flow', () => {
  it('builds a scan URL against the frontend origin, never the API', async () => {
    const { scanUrlFor } = await import('../../src/services/qrService.js');
    const { config } = await import('../../src/config/index.js');

    const url = scanUrlFor('abcdefgh1234');

    assert.equal(url, `${config.publicFrontendUrl}/q/abcdefgh1234`);
    assert.notEqual(config.publicFrontendUrl, config.publicApiUrl);
    assert.doesNotMatch(url, /:4000/);
  });

  it('encodes the token, so it cannot break out of the path', async () => {
    const { scanUrlFor } = await import('../../src/services/qrService.js');
    const { config } = await import('../../src/config/index.js');

    const url = scanUrlFor('a/../../evil');

    // The separator is encoded, so the value stays a single path segment
    // whatever it contains. `..` with no slash beside it traverses nothing.
    assert.equal(url, `${config.publicFrontendUrl}/q/a%2F..%2F..%2Fevil`);
    assert.equal(new URL(url).pathname.split('/').length, 3);
  });
});
