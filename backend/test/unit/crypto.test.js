import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CryptoError,
  PiiProtector,
  hashToken,
  randomToken,
  secureCompare,
} from '../../src/domain/crypto.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

describe('PiiProtector — key handling', () => {
  it('requires exactly 32 bytes', () => {
    assert.throws(() => new PiiProtector(Buffer.alloc(16).toString('base64')), CryptoError);
    assert.throws(() => new PiiProtector(Buffer.alloc(64).toString('base64')), CryptoError);
    assert.throws(() => new PiiProtector(''), CryptoError);
    assert.throws(() => new PiiProtector(null), CryptoError);
  });

  it('tells the operator how to generate a valid key', () => {
    try {
      new PiiProtector('short');
    } catch (error) {
      assert.match(error.message, /openssl rand -base64 32/);
    }
  });

  it('does not expose the key on the instance', () => {
    const protector = new PiiProtector(KEY);
    // A private field, so an accidental JSON.stringify of a service object
    // cannot serialise the encryption key into a log.
    assert.equal(JSON.stringify(protector), '{}');
    assert.deepEqual(Object.keys(protector), []);
  });
});

describe('PiiProtector — encryption', () => {
  const protector = new PiiProtector(KEY);

  it('round-trips a value', () => {
    const payload = protector.encrypt('+15555550123');
    assert.notEqual(payload, '+15555550123');
    assert.equal(protector.decrypt(payload), '+15555550123');
  });

  it('produces the documented v1 format', () => {
    const parts = protector.encrypt('secret').split(':');
    assert.equal(parts.length, 4);
    assert.equal(parts[0], 'v1');
  });

  it('never produces the same ciphertext twice', () => {
    // A repeated IV under the same key is catastrophic for GCM.
    const seen = new Set();
    for (let i = 0; i < 50; i += 1) seen.add(protector.encrypt('identical input'));
    assert.equal(seen.size, 50);
  });

  it('round-trips unicode and long values intact', () => {
    for (const value of ['Zoë 🙏 Ünïcode', 'a'.repeat(5000), '{"json":"like"}', '   ']) {
      assert.equal(protector.decrypt(protector.encrypt(value)), value);
    }
  });

  it('treats empty input as null rather than encrypting nothing', () => {
    assert.equal(protector.encrypt(''), null);
    assert.equal(protector.encrypt(null), null);
    assert.equal(protector.encrypt(undefined), null);
    assert.equal(protector.decrypt(null), null);
    assert.equal(protector.decrypt(''), null);
  });
});

describe('PiiProtector — tamper resistance', () => {
  const protector = new PiiProtector(KEY);

  it('rejects modified ciphertext', () => {
    const [version, iv, tag] = protector.encrypt('original').split(':');
    const forged = [version, iv, tag, Buffer.from('tampered').toString('base64')].join(':');
    assert.throws(() => protector.decrypt(forged), CryptoError);
  });

  it('rejects a modified authentication tag', () => {
    const [version, iv, , ciphertext] = protector.encrypt('original').split(':');
    const forged = [version, iv, Buffer.alloc(16, 1).toString('base64'), ciphertext].join(':');
    assert.throws(() => protector.decrypt(forged), CryptoError);
  });

  it('rejects a wrong key', () => {
    const payload = protector.encrypt('secret');
    assert.throws(() => new PiiProtector(OTHER_KEY).decrypt(payload), CryptoError);
  });

  it('rejects malformed and unversioned payloads', () => {
    for (const bad of ['not-encrypted', 'v1:only:three', 'v2:a:b:c', 'a:b:c:d']) {
      assert.throws(() => protector.decrypt(bad), CryptoError, `should reject "${bad}"`);
    }
  });

  it('tryDecrypt returns a fallback instead of throwing', () => {
    // One row encrypted under a rotated key must not fail an entire listing.
    assert.equal(protector.tryDecrypt('garbage'), null);
    assert.equal(protector.tryDecrypt('garbage', '[unavailable]'), '[unavailable]');
    assert.equal(protector.tryDecrypt(protector.encrypt('fine')), 'fine');
  });
});

describe('PiiProtector — lookup hashes', () => {
  const protector = new PiiProtector(KEY);

  it('is deterministic, so it can be indexed and compared', () => {
    assert.equal(protector.lookupHash('+15555550123'), protector.lookupHash('+15555550123'));
  });

  it('does not leak the input', () => {
    const hash = protector.lookupHash('+15555550123');
    assert.doesNotMatch(hash, /5555550123/);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('separates domains, so a phone hash never collides with an IP hash', () => {
    assert.notEqual(
      protector.lookupHash('203.0.113.1', 'phone'),
      protector.lookupHash('203.0.113.1', 'ip'),
    );
  });

  it('is keyed, so the same input under a different key differs', () => {
    // This is the property that makes it irreversible: a plain SHA-256 of a
    // phone number is brute-forced from a ~10^10 space in seconds.
    assert.notEqual(
      protector.lookupHash('+15555550123'),
      new PiiProtector(OTHER_KEY).lookupHash('+15555550123'),
    );
  });
});

describe('secureCompare', () => {
  it('compares correctly', () => {
    assert.equal(secureCompare('abc', 'abc'), true);
    assert.equal(secureCompare('abc', 'abd'), false);
    assert.equal(secureCompare('', ''), true);
  });

  it('handles length mismatches without throwing', () => {
    // timingSafeEqual throws on unequal buffer lengths; comparing fixed-size
    // digests avoids both the throw and the early-return timing leak.
    assert.equal(secureCompare('short', 'much longer value'), false);
    assert.equal(secureCompare(null, 'value'), false);
    assert.equal(secureCompare(undefined, undefined), true);
  });
});

describe('token helpers', () => {
  it('generates URL-safe tokens with no collisions', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken(32)));
    assert.equal(tokens.size, 500);
    for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  it('respects the requested entropy', () => {
    assert.ok(randomToken(8).length < randomToken(48).length);
  });

  it('hashes tokens deterministically and irreversibly', () => {
    const token = randomToken();
    const hash = hashToken(token, 'server-key');

    assert.equal(hash, hashToken(token, 'server-key'));
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes(token));
  });

  it('separates domains and keys', () => {
    const token = 'fixed-token';
    assert.notEqual(hashToken(token, 'key-a'), hashToken(token, 'key-b'));
    assert.notEqual(hashToken(token, 'key', 'refresh'), hashToken(token, 'key', 'reset'));
  });
});
