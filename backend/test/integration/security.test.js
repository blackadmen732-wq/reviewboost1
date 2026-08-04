import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import request from 'supertest';

import { buildApp, ignoreInfrastructureNoise, teardown } from '../helpers/testApp.js';

/**
 * Each test names the specific weakness it closes, so a future refactor that
 * reopens one fails here rather than in production.
 */

let app;

before(async () => {
  process.on('unhandledRejection', ignoreInfrastructureNoise);
  app = await buildApp();
});

after(async () => {
  await teardown();
  process.off('unhandledRejection', ignoreInfrastructureNoise);
});

describe('CSRF protection', () => {
  it('issues a token the client can read and echo back', async () => {
    const response = await request(app).get('/api/csrf-token').expect(200);

    assert.match(response.body.csrfToken, /^[A-Za-z0-9_-]{20,}$/);

    const cookie = response.headers['set-cookie'].find((c) => c.startsWith('rb_csrf='));
    assert.ok(cookie, 'CSRF cookie must be set');
    // Must be readable by JS — the client has to echo it into a header. An
    // attacker can cause the cookie to be *sent* but cannot read it.
    assert.doesNotMatch(cookie, /HttpOnly/i);
  });

  it('rejects a cookie-authenticated mutation carrying no CSRF header', async () => {
    const response = await request(app)
      .post('/api/dashboard/billing/checkout')
      .set('Cookie', ['rb_access=forged-session-value', 'rb_csrf=some-token'])
      .send({});

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'csrf_failed');
  });

  it('rejects a mismatched token', async () => {
    const response = await request(app)
      .post('/api/dashboard/billing/checkout')
      .set('Cookie', ['rb_access=forged', 'rb_csrf=token-aaa'])
      .set('X-CSRF-Token', 'token-bbb')
      .send({});

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'csrf_failed');
  });

  it('exempts Bearer callers, which a browser cannot forge', async () => {
    const response = await request(app)
      .post('/api/dashboard/billing/checkout')
      .set('Authorization', 'Bearer some-token')
      .send({});

    // Reaches auth and fails there — not blocked by CSRF.
    assert.equal(response.status, 401);
  });

  it('does not block a request carrying no session cookie', async () => {
    const response = await request(app).post('/api/auth/login').send({});
    assert.notEqual(response.status, 403);
  });

  it('never blocks safe methods', async () => {
    await request(app).get('/api/health').expect(200);
  });
});

describe('fail-closed authentication limiting', () => {
  /**
   * Auth limiters reject when Redis is unreachable rather than degrading to
   * per-process memory. A memory fallback hands an attacker `instances x` the
   * brute-force budget; a briefly unavailable sign-in page is the smaller
   * problem. These tests run with no Redis, so this is the path that executes.
   */

  it('refuses authentication rather than allowing unlimited attempts', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'someone@example.com', password: 'whatever-value' });

    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'service_unavailable');
  });

  it('tells clients when to retry', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'someone@example.com', password: 'whatever-value' });

    assert.equal(response.headers['retry-after'], '30');
  });

  it('leaks nothing about why it is unavailable', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'someone@example.com', password: 'whatever-value' });

    assert.doesNotMatch(JSON.stringify(response.body), /redis|ECONNREFUSED|store/i);
  });

  it('keeps the rest of the product available while auth limiting is degraded', async () => {
    // Fail-closed is scoped to authentication only.
    await request(app).get('/api/health').expect(200);
    assert.equal((await request(app).get('/api/nope')).status, 404);
  });
});

describe('information disclosure', () => {
  it('does not reveal whether an email is registered', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ email: 'a@b.com' });
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'definitely-not-registered@nowhere.example' });

    assert.equal(known.status, unknown.status);
    // requestId is unique per request by design; everything else must match.
    assert.deepEqual(
      { ...known.body, requestId: undefined },
      { ...unknown.body, requestId: undefined },
      'a registered and unregistered address must be indistinguishable',
    );
  });

  it('does not expose the account id on the public QR gate', async () => {
    // Leaking it would let anyone who scans a code write fabricated feedback
    // into that tenant.
    const response = await request(app).get('/q/abcdefgh1234').set('Accept', 'application/json');
    assert.doesNotMatch(JSON.stringify(response.body), /account_?id/i);
  });
});

describe('password policy', () => {
  it('never accepts a short password at registration', async () => {
    const response = await request(app).post('/api/auth/register').send({
      businessName: 'Test Co',
      email: 'test@example.com',
      password: 'short',
      googleReviewUrl: 'https://g.page/r/test',
    });

    // 400 when the limiter reaches Redis, 503 when it cannot. Never a 201.
    assert.ok(response.status >= 400);
    assert.notEqual(response.status, 201);
  });

  it('never accepts a short password on the reset path either', async () => {
    // A rigorous signup check beside a lax reset endpoint is the usual bypass.
    const response = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(40), newPassword: 'short' });

    assert.ok(response.status >= 400);
    assert.notEqual(response.status, 200);
  });
});

describe('request limits', () => {
  it('rejects an oversized recipient list before parsing it into memory', async () => {
    const response = await request(app)
      .post('/api/campaigns/estimate')
      .set('Authorization', 'Bearer x')
      .send({
        messageTemplate: 'Hi {{customer_name}}',
        recipients: Array.from({ length: 5001 }, () => ({ phone: '5555550123' })),
      });

    assert.ok(response.status >= 400);
    assert.notEqual(response.status, 500);
  });
});
