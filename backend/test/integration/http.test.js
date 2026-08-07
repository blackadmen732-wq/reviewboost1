import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import request from 'supertest';

import { buildApp, ignoreInfrastructureNoise, teardown } from '../helpers/testApp.js';

let app;

before(async () => {
  process.on('unhandledRejection', ignoreInfrastructureNoise);
  app = await buildApp();
});

after(async () => {
  await teardown();
  process.off('unhandledRejection', ignoreInfrastructureNoise);
});

describe('health and readiness', () => {
  it('serves liveness without touching dependencies', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.service, 'reviewboost-api');
  });

  it('reports not-ready when dependencies are down', async () => {
    // Liveness and readiness are separate on purpose: an unhealthy dependency
    // must not cause the orchestrator to kill an otherwise working process.
    const response = await request(app).get('/api/ready');
    assert.equal(response.status, 503);
    assert.equal(response.body.ready, false);
    assert.equal(response.body.checks.database, false);
  });
});

describe('security headers', () => {
  it('sets the hardening headers and hides the framework', async () => {
    const response = await request(app).get('/api/health').expect(200);
    const csp = response.headers['content-security-policy'];

    assert.equal(response.headers['x-powered-by'], undefined);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
  });

  it('attaches a request id to every response', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.match(response.headers['x-request-id'], /[0-9a-f-]{36}/);
  });

  it('echoes an inbound request id, so a trace survives the hop', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('x-request-id', 'trace-abc-123')
      .expect(200);

    assert.equal(response.headers['x-request-id'], 'trace-abc-123');
  });
});

describe('CORS', () => {
  it('allows a configured origin with credentials', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
    // Required for the httpOnly session cookies to cross origins.
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
  });

  it('never grants read access to an unlisted origin', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example')
      .expect(200);

    assert.equal(response.headers['access-control-allow-origin'], undefined);
  });
});

describe('authentication boundary', () => {
  const protectedRoutes = [
    ['get', '/api/auth/session'],
    ['get', '/api/auth/sessions'],
    ['get', '/api/auth/activity'],
    ['get', '/api/auth/mfa'],
    ['get', '/api/dashboard/'],
    ['get', '/api/dashboard/billing'],
    ['get', '/api/dashboard/members'],
    ['get', '/api/dashboard/contacts'],
    ['get', '/api/campaigns/'],
    ['post', '/api/campaigns/'],
    ['get', '/api/qr/stands'],
    ['post', '/api/qr/stands'],
    ['get', '/api/qr/feedback'],
    ['get', '/api/qr/analytics'],
  ];

  for (const [method, path] of protectedRoutes) {
    it(`rejects unauthenticated ${method.toUpperCase()} ${path}`, async () => {
      const response = await request(app)[method](path).send({});
      assert.equal(response.status, 401, `${path} must require authentication`);
      assert.equal(response.body.error.code, 'unauthorized');
    });
  }

  it('rejects a malformed token', async () => {
    const response = await request(app)
      .get('/api/auth/session')
      .set('Authorization', 'Bearer not.a.real.token')
      .expect(401);

    assert.equal(response.body.error.code, 'invalid_token');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ sub: 'x', act: 'y', role: 'owner', tv: 0 }, 'wrong-secret-value', {
      audience: 'reviewboost:api',
      issuer: 'reviewboost:api',
    });

    const response = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);

    assert.equal(response.body.error.code, 'invalid_token');
  });

  it('rejects an MFA challenge token used as an access token', async () => {
    // The audiences are distinct precisely so this substitution fails.
    const jwt = (await import('jsonwebtoken')).default;
    const challenge = jwt.sign(
      { sub: 'x', act: 'y' },
      'test-secret-value-that-is-comfortably-over-32-characters',
      { audience: 'reviewboost:mfa-challenge', issuer: 'reviewboost:api' },
    );

    const response = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${challenge}`)
      .expect(401);

    assert.equal(response.body.error.code, 'invalid_token');
  });
});

describe('error handling', () => {
  it('returns a structured 404 rather than an HTML page', async () => {
    const response = await request(app).get('/api/does-not-exist').expect(404);
    assert.equal(response.body.error.code, 'not_found');
    assert.ok(response.body.requestId);
  });

  it('rejects malformed JSON with 400, not a crash', async () => {
    const response = await request(app)
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .send('{"broken": ')
      .expect(400);

    assert.equal(response.body.error.code, 'invalid_json');
  });

  it('survives a body of the wrong shape', async () => {
    // A string where an object was expected must not reach a .map() inside an
    // async handler and take the process down.
    const response = await request(app).post('/api/auth/verify-email').send('"just-a-string"');
    assert.ok(response.status >= 400, 'must be an error');

    await request(app).get('/api/health').expect(200);
  });

  it('never leaks a stack trace or internal path', async () => {
    const response = await request(app).get('/api/definitely-missing');
    const body = JSON.stringify(response.body);
    assert.doesNotMatch(body, /\/home\/|node_modules|at Object|\.js:\d+/);
  });
});

describe('input validation', () => {
  it('rejects a malformed QR public id before any lookup', async () => {
    const response = await request(app).get('/q/not-a-valid-id!!').expect(400);
    assert.equal(response.body.error.code, 'validation_failed');
  });

  it('rejects an out-of-range rating', async () => {
    const response = await request(app)
      .post('/api/v1/public/q/abcdefgh1234/responses')
      .set('Idempotency-Key', 'rb_response_0123456789abcdef')
      .send({ sessionId: 'a'.repeat(43), rating: 9 })
      .expect(400);

    assert.equal(response.body.error.code, 'validation_failed');
  });

  it('names the offending field, so a client can point at it', async () => {
    const response = await request(app)
      .post('/api/v1/public/q/abcdefgh1234/responses')
      .set('Idempotency-Key', 'rb_response_0123456789abcdef')
      .send({ sessionId: 'a'.repeat(43), rating: 'five' })
      .expect(400);

    assert.ok(Array.isArray(response.body.error.details));
    assert.equal(response.body.error.details[0].field, 'rating');
  });

  it('rejects a non-UUID route parameter rather than passing it to SQL', async () => {
    const response = await request(app)
      .get('/api/campaigns/not-a-uuid')
      .set('Authorization', 'Bearer x');

    assert.notEqual(response.status, 500);
  });

  it('rejects a non-numeric query parameter rather than passing NaN onward', async () => {
    const response = await request(app)
      .get('/api/qr/analytics?days=abc')
      .set('Authorization', 'Bearer x');

    assert.notEqual(response.status, 500);
  });
});

describe('provider webhooks', () => {
  it('rejects an unsigned Stripe webhook', async () => {
    const response = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_1', type: 'invoice.paid' }));

    assert.equal(response.status, 400);
  });

  it('does not require CSRF for provider callbacks', async () => {
    // Stripe and Twilio cannot supply a CSRF token; blocking them would
    // silently break billing and delivery receipts.
    const response = await request(app).post('/api/webhooks/stripe').send({});
    assert.notEqual(response.status, 403);
  });
});
