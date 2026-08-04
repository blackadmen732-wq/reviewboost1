import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isValidPhone,
  maskPhone,
  normalizeBatch,
  normalizePhone,
  phoneDedupeKey,
} from '../../src/domain/phone.js';

/**
 * A wrong normalisation means texting a stranger. These tests lock in the rule
 * that anything ambiguous is rejected rather than guessed at.
 */

describe('normalizePhone — accepts', () => {
  it('every common NANP format', () => {
    const expected = '+15555550123';
    for (const input of [
      '5555550123',
      '555-555-0123',
      '(555) 555-0123',
      '555.555.0123',
      '15555550123',
      '1 555 555 0123',
      '+1 555 555 0123',
      '+1 (555) 555-0123',
      '  5555550123  ',
    ]) {
      assert.equal(normalizePhone(input), expected, `failed on "${input}"`);
    }
  });

  it('explicit international numbers', () => {
    assert.equal(normalizePhone('+442071234567'), '+442071234567');
    assert.equal(normalizePhone('+44 20 7123 4567'), '+442071234567');
    // 00 is the ITU international access prefix.
    assert.equal(normalizePhone('00442071234567'), '+442071234567');
  });

  it('a national number when given a non-NANP default country', () => {
    assert.equal(normalizePhone('2071234567', '44'), '+442071234567');
  });
});

describe('normalizePhone — rejects', () => {
  it('empty and non-numeric input', () => {
    for (const input of ['', '   ', null, undefined, 'not a phone', '---', 'abc-def-ghij']) {
      assert.equal(normalizePhone(input), '', `should reject ${JSON.stringify(input)}`);
    }
  });

  it('numbers of implausible length', () => {
    assert.equal(normalizePhone('12345'), '');
    assert.equal(normalizePhone('+1234567890123456789'), '');
    assert.equal(normalizePhone('555012'), '');
  });

  it('NANP numbers with an invalid area or exchange code', () => {
    // Area and exchange codes must both start 2-9. These are the ranges that
    // never reach a real handset, and accepting them hides upload typos.
    assert.equal(normalizePhone('1555550123'), '');
    assert.equal(normalizePhone('0555550123'), '');
    assert.equal(normalizePhone('5551550123'), '');
  });

  it('ambiguous digit counts in a NANP context', () => {
    // 9 or 12 digits with no + is not something we should guess about.
    assert.equal(normalizePhone('555555012'), '');
    assert.equal(normalizePhone('255555501234'), '');
  });

  it('international numbers whose country code starts with zero', () => {
    assert.equal(normalizePhone('+0442071234567'), '');
  });
});

describe('phoneDedupeKey', () => {
  it('collapses every equivalent form to one key', () => {
    const key = phoneDedupeKey('5555550123');
    assert.equal(key, '5555550123');

    for (const variant of ['+15555550123', '1-555-555-0123', '(555) 555-0123']) {
      assert.equal(phoneDedupeKey(variant), key, `failed on "${variant}"`);
    }
  });

  it('keeps genuinely different numbers distinct', () => {
    assert.notEqual(phoneDedupeKey('5555550123'), phoneDedupeKey('5555550124'));
  });

  it('preserves the country code for non-NANP numbers', () => {
    assert.equal(phoneDedupeKey('+442071234567'), '442071234567');
  });

  it('returns empty for anything unnormalisable', () => {
    assert.equal(phoneDedupeKey('garbage'), '');
  });
});

describe('maskPhone', () => {
  it('shows only the last four digits', () => {
    assert.equal(maskPhone('+15555550123'), '•••• 0123');
    assert.equal(maskPhone('5555550123'), '•••• 0123');
  });

  it('reveals nothing when there is too little to mask', () => {
    assert.equal(maskPhone(''), '');
    assert.equal(maskPhone('12'), '');
  });
});

describe('normalizeBatch', () => {
  it('separates valid from invalid without dropping anything silently', () => {
    const { valid, invalid } = normalizeBatch([
      '5555550123',
      'garbage',
      '+442071234567',
      '',
    ]);

    assert.equal(valid.length, 2);
    assert.equal(invalid.length, 2);
    // Every input is accounted for in one bucket or the other.
    assert.equal(valid.length + invalid.length, 4);
  });

  it('reports the original index so a UI can point at the bad row', () => {
    const { invalid } = normalizeBatch(['5555550123', 'garbage']);
    assert.equal(invalid[0].index, 1);
    assert.equal(invalid[0].reason, 'invalid_phone');
  });

  it('catches duplicates written in different formats', () => {
    const { valid, invalid } = normalizeBatch([
      '5555550123',
      '+1 (555) 555-0123',
      '5555550124',
    ]);

    assert.equal(valid.length, 2, 'the same person must not be texted twice');
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0].reason, 'duplicate_in_batch');
    assert.equal(invalid[0].duplicateOfIndex, 0);
  });

  it('handles an empty batch', () => {
    const { valid, invalid } = normalizeBatch([]);
    assert.equal(valid.length, 0);
    assert.equal(invalid.length, 0);
  });
});

describe('isValidPhone', () => {
  it('agrees with normalizePhone', () => {
    assert.equal(isValidPhone('5555550123'), true);
    assert.equal(isValidPhone('12345'), false);
  });
});
