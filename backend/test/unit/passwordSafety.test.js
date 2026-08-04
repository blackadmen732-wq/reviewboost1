import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkPasswordSafety } from '../../src/domain/passwordSafety.js';

/**
 * The HIBP call is injected rather than mocked globally, so these run offline
 * and deterministically — and so the production code has no test-only branch.
 */

function stubHibp(body, { ok = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok, status: ok ? 200 : 503, text: async () => body };
  };
  return { fetchImpl, calls };
}

const NEVER_CALLED = {
  fetchImpl: async () => {
    throw new Error('HIBP should not have been called');
  },
};

describe('breach detection', () => {
  it('rejects a password present in the corpus', async () => {
    // Deliberately NOT in the local obvious-password list, so this exercises
    // the breach path rather than short-circuiting before the lookup.
    // SHA1("Tr0ub4dor&3xyz") = 28A3A 91021E8FA93FAA7F4ED3F7CCC354E66307A
    const { fetchImpl } = stubHibp(
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\r\n91021E8FA93FAA7F4ED3F7CCC354E66307A:24230577',
    );

    const result = await checkPasswordSafety('Tr0ub4dor&3xyz', {}, { fetchImpl });
    assert.equal(result.safe, false);
    assert.equal(result.breachCount, 24230577);
    assert.match(result.reason, /24,230,577|breach/i);
  });

  it('short-circuits obvious passwords before any lookup', async () => {
    // No network call for something already known to be hopeless.
    const result = await checkPasswordSafety('password123', {}, NEVER_CALLED);
    assert.equal(result.safe, false);
    assert.equal(result.breachCount, 0, 'rejected locally, so no breach count is available');
  });

  it('accepts a password absent from the corpus', async () => {
    const { fetchImpl } = stubHibp('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3');

    const result = await checkPasswordSafety('correct-horse-battery-staple-9471', {}, { fetchImpl });
    assert.equal(result.safe, true);
    assert.equal(result.checked, true);
  });

  it('sends only a five-character hash prefix, never the password', async () => {
    const { fetchImpl, calls } = stubHibp('AAAA:1');
    await checkPasswordSafety('my-actual-secret-password', {}, { fetchImpl });

    const { url, options } = calls[0];
    assert.match(url, /pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
    assert.doesNotMatch(url, /actual-secret/);
    // Padding hides how many hashes shared the prefix.
    assert.equal(options.headers['Add-Padding'], 'true');
  });

  it('is case-sensitive about the password itself', async () => {
    const { calls, fetchImpl } = stubHibp('AAAA:1');
    await checkPasswordSafety('SomePassword1234', {}, { fetchImpl });
    await checkPasswordSafety('somepassword1234', {}, { fetchImpl });

    assert.notEqual(calls[0].url, calls[1].url, 'different passwords must hash differently');
  });
});

describe('availability', () => {
  it('stays available when the corpus is unreachable, and records the gap', async () => {
    const result = await checkPasswordSafety(
      'correct-horse-battery-staple-9471',
      {},
      {
        fetchImpl: async () => {
          throw new Error('network down');
        },
      },
    );

    // A third-party outage must not block every signup and password reset.
    assert.equal(result.safe, true);
    // But the caller can see the check did not actually happen.
    assert.equal(result.checked, false);
  });

  it('treats a non-200 response as unavailable rather than as a pass', async () => {
    const { fetchImpl } = stubHibp('', { ok: false });
    const result = await checkPasswordSafety('correct-horse-battery-staple-9471', {}, { fetchImpl });
    assert.equal(result.checked, false);
  });
});

describe('local checks', () => {
  it('rejects obvious passwords without a network call', async () => {
    const result = await checkPasswordSafety('password123', {}, NEVER_CALLED);
    assert.equal(result.safe, false);
  });

  it('rejects a single repeated character', async () => {
    const result = await checkPasswordSafety('aaaaaaaaaaaaaaa', {}, NEVER_CALLED);
    assert.equal(result.safe, false);
    assert.match(result.reason, /repeated/i);
  });

  it('rejects keyboard and alphabet sequences', async () => {
    for (const sequence of ['1234567890123', 'qwertyuiop123', 'abcdefghij123']) {
      const result = await checkPasswordSafety(sequence, {}, NEVER_CALLED);
      assert.equal(result.safe, false, `${sequence} should be rejected`);
    }
  });

  it('rejects a password containing the user\'s own email name', async () => {
    // An attacker targeting one business already knows this.
    const result = await checkPasswordSafety(
      'samsmith-longpassword',
      { email: 'samsmith@example.com' },
      NEVER_CALLED,
    );

    assert.equal(result.safe, false);
    assert.match(result.reason, /must not contain your email/i);
  });

  it('rejects a password containing the business name', async () => {
    const result = await checkPasswordSafety(
      'joespizza-longpassword',
      { businessName: "Joe's Pizza" },
      NEVER_CALLED,
    );

    assert.equal(result.safe, false);
    assert.match(result.reason, /businessName/i);
  });

  it('does not reject on a short incidental overlap', async () => {
    // "Jo" is too short to be meaningful — rejecting on it would be noise.
    const { fetchImpl } = stubHibp('AAAA:1');
    const result = await checkPasswordSafety(
      'jonquil-meadow-cascade-71',
      { businessName: 'Jo' },
      { fetchImpl },
    );

    assert.equal(result.safe, true);
  });
});
