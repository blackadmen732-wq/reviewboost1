import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyInboundKeyword,
  ensureOptOutNotice,
  evaluateSendEligibility,
  hasDefensibleConsent,
  isWithinSendingWindow,
  millisecondsUntilSendingWindow,
} from '../../src/domain/compliance.js';

/**
 * Each of these maps to a statutory obligation. A regression here is a legal
 * exposure of $500–$1,500 per message, so everything fails closed.
 */

describe('classifyInboundKeyword', () => {
  it('recognises every carrier-mandated opt-out keyword', () => {
    for (const keyword of ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) {
      assert.equal(classifyInboundKeyword(keyword), 'stop', `${keyword} must opt out`);
    }
  });

  it('is case and punctuation insensitive, as real replies are', () => {
    for (const reply of ['stop', 'Stop', '  STOP  ', 'STOP!', 'stop.', 'Stop?']) {
      assert.equal(classifyInboundKeyword(reply), 'stop', `"${reply}" must opt out`);
    }
  });

  it('recognises opt-in and help keywords', () => {
    assert.equal(classifyInboundKeyword('START'), 'start');
    assert.equal(classifyInboundKeyword('unstop'), 'start');
    assert.equal(classifyInboundKeyword('HELP'), 'help');
    assert.equal(classifyInboundKeyword('info'), 'help');
  });

  it('does not treat ordinary replies as commands', () => {
    for (const reply of ['hello there', 'thanks!', 'I stopped by yesterday', '', '   ']) {
      assert.equal(classifyInboundKeyword(reply), null, `"${reply}" is not a command`);
    }
  });
});

describe('ensureOptOutNotice', () => {
  it('appends a notice when one is missing', () => {
    assert.match(ensureOptOutNotice('Please review us'), /Reply STOP to opt out\./);
  });

  it('does not duplicate an existing notice', () => {
    const already = 'Review us. Reply STOP to opt out.';
    assert.equal(ensureOptOutNotice(already), already);
  });

  it('recognises a differently worded notice', () => {
    const custom = 'Text STOP to unsubscribe';
    assert.equal(ensureOptOutNotice(custom), custom);
  });

  it('matches the word, not the substring', () => {
    // Regression: `\bstop\b` treats a hyphen as a word boundary, so it matched
    // "one-stop" and "non-stop" and shipped those messages with NO opt-out
    // instruction — a per-message statutory violation.
    for (const body of [
      'We stopped by',
      'Your one-stop shop',
      'Non-stop service',
      'The bus stops here',
      "Stop's Diner",
    ]) {
      assert.match(
        ensureOptOutNotice(body),
        /Reply STOP to opt out\./,
        `"${body}" contains no opt-out instruction and must get one`,
      );
    }
  });

  it('recognises a genuine instruction in any casing or phrasing', () => {
    for (const body of [
      'Review us. Reply STOP to opt out.',
      'Review us. reply stop to unsubscribe',
      'Text STOP to end these messages',
      'Send STOP anytime.',
    ]) {
      assert.equal(
        ensureOptOutNotice(body),
        body,
        `"${body}" already instructs the recipient and must not be appended to`,
      );
    }
  });

  it('returns just the notice for an empty body', () => {
    assert.equal(ensureOptOutNotice(''), 'Reply STOP to opt out.');
  });
});

describe('isWithinSendingWindow', () => {
  it('evaluates in the recipient timezone, not the server', () => {
    const instant = new Date('2026-01-15T03:00:00Z');

    // 03:00 UTC is 22:00 in New York — outside an 8..21 window.
    assert.equal(isWithinSendingWindow(instant, 'America/New_York', 8, 21), false);
    // The same instant is 12:00 in Tokyo — inside it. This is the whole point.
    assert.equal(isWithinSendingWindow(instant, 'Asia/Tokyo', 8, 21), true);
  });

  it('is inclusive at the start hour and exclusive at the end', () => {
    // 13:00 UTC = 08:00 New York, the first legal hour.
    assert.equal(
      isWithinSendingWindow(new Date('2026-01-15T13:00:00Z'), 'America/New_York', 8, 21),
      true,
    );
    // 02:00 UTC next day = 21:00 New York, the first illegal hour.
    assert.equal(
      isWithinSendingWindow(new Date('2026-01-16T02:00:00Z'), 'America/New_York', 8, 21),
      false,
    );
  });

  it('fails closed on an invalid timezone', () => {
    // The value is wrong rather than absent, so guessing would mean texting
    // someone at 3am.
    assert.equal(isWithinSendingWindow(new Date(), 'Not/AZone', 8, 21), false);
    assert.equal(isWithinSendingWindow(new Date(), 'Mars/Olympus', 8, 21), false);
  });

  it('assumes UTC when the timezone is simply absent', () => {
    // Distinct from invalid: failing closed here would block every send for a
    // contact whose timezone was never collected. Supplying a sensible default
    // is the caller's responsibility.
    const middayUtc = new Date('2026-01-15T12:00:00Z');
    for (const missing of ['', '   ', null, undefined]) {
      assert.equal(
        isWithinSendingWindow(middayUtc, missing, 8, 21),
        true,
        `${JSON.stringify(missing)} should fall back to UTC`,
      );
    }

    const nightUtc = new Date('2026-01-15T03:00:00Z');
    assert.equal(isWithinSendingWindow(nightUtc, null, 8, 21), false);
  });
});

describe('millisecondsUntilSendingWindow', () => {
  it('returns zero when sending is permitted now', () => {
    const midday = new Date('2026-01-15T17:00:00Z'); // 12:00 New York
    assert.equal(millisecondsUntilSendingWindow(midday, 'America/New_York', 8, 21), 0);
  });

  it('defers until the next legal hour', () => {
    const night = new Date('2026-01-15T03:00:00Z'); // 22:00 New York
    const deferMs = millisecondsUntilSendingWindow(night, 'America/New_York', 8, 21);

    assert.ok(deferMs > 0, 'must defer');
    // 22:00 to 08:00 is ten hours.
    assert.equal(deferMs, 10 * 3_600_000);

    // And the deferred instant must genuinely be inside the window.
    const deferredTo = new Date(night.getTime() + deferMs);
    assert.equal(isWithinSendingWindow(deferredTo, 'America/New_York', 8, 21), true);
  });

  it('defers rather than blocking forever on an unknown timezone', () => {
    const deferMs = millisecondsUntilSendingWindow(new Date(), 'Not/AZone', 8, 21);
    assert.equal(deferMs, 3_600_000);
  });
});

describe('hasDefensibleConsent', () => {
  it('requires both the flag and a timestamp', () => {
    const at = '2026-01-01T00:00:00Z';
    assert.equal(hasDefensibleConsent({ consent: true, consent_at: at }), true);
    assert.equal(hasDefensibleConsent({ consent: true, consentAt: at }), true);

    // "We think they said yes" with no record of when is what a TCPA claim
    // turns on.
    assert.equal(hasDefensibleConsent({ consent: true }), false);
    assert.equal(hasDefensibleConsent({ consent: false, consent_at: at }), false);
    assert.equal(hasDefensibleConsent({}), false);
    assert.equal(hasDefensibleConsent(null), false);
  });

  it('rejects a corrupt or future-dated timestamp', () => {
    assert.equal(hasDefensibleConsent({ consent: true, consent_at: 'not a date' }), false);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal(hasDefensibleConsent({ consent: true, consent_at: tomorrow }), false);
  });
});

describe('evaluateSendEligibility', () => {
  const consented = { consent: true, consent_at: '2026-01-01T00:00:00Z', timezone: 'UTC' };
  const middayUtc = new Date('2026-01-15T12:00:00Z');

  it('allows a consented, unsuppressed, first-time recipient', () => {
    const result = evaluateSendEligibility({
      contact: consented,
      isSuppressed: false,
      recentlyMessaged: false,
      now: middayUtc,
    });

    assert.equal(result.allowed, true);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.deferMs, 0);
  });

  it('blocks a suppressed recipient', () => {
    const result = evaluateSendEligibility({
      contact: consented,
      isSuppressed: true,
      recentlyMessaged: false,
      now: middayUtc,
    });

    assert.equal(result.allowed, false);
    assert.ok(result.reasons.includes('suppressed'));
  });

  it('blocks a recipient with no defensible consent', () => {
    const result = evaluateSendEligibility({
      contact: { consent: false },
      isSuppressed: false,
      recentlyMessaged: false,
      now: middayUtc,
    });

    assert.equal(result.allowed, false);
    assert.ok(result.reasons.includes('no_consent'));
  });

  it('reports every failing reason, not just the first', () => {
    const result = evaluateSendEligibility({
      contact: { consent: false },
      isSuppressed: true,
      recentlyMessaged: true,
      now: middayUtc,
    });

    assert.equal(result.reasons.length, 3);
    for (const reason of ['suppressed', 'duplicate', 'no_consent']) {
      assert.ok(result.reasons.includes(reason), `expected ${reason}`);
    }
  });

  it('defers rather than blocks during quiet hours', () => {
    const night = new Date('2026-01-15T03:00:00Z');
    const result = evaluateSendEligibility({
      contact: { ...consented, timezone: 'America/New_York' },
      isSuppressed: false,
      recentlyMessaged: false,
      now: night,
    });

    // Still eligible — just not yet. The message is legal, the timing is not.
    assert.equal(result.allowed, true);
    assert.ok(result.deferMs > 0);
  });

  it('can waive the consent requirement for transactional sends', () => {
    const result = evaluateSendEligibility({
      contact: { consent: false, timezone: 'UTC' },
      isSuppressed: false,
      recentlyMessaged: false,
      requireConsent: false,
      now: middayUtc,
    });

    assert.equal(result.allowed, true);
  });

  it('never waives suppression, even transactionally', () => {
    const result = evaluateSendEligibility({
      contact: { consent: false, timezone: 'UTC' },
      isSuppressed: true,
      recentlyMessaged: false,
      requireConsent: false,
      now: middayUtc,
    });

    assert.equal(result.allowed, false);
    assert.ok(result.reasons.includes('suppressed'));
  });
});
