import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENCODING,
  calculateSegments,
  findNonGsmCharacters,
  fitsSingleSegment,
} from '../../src/domain/sms.js';

/**
 * Segment counting decides what customers are billed. The boundary cases below
 * are the ones a naive `length / 160` gets wrong, and each is a real invoice
 * discrepancy rather than a theoretical edge case.
 */

describe('GSM-7 segmentation', () => {
  it('counts an empty message as zero segments', () => {
    assert.equal(calculateSegments('').segments, 0);
    assert.equal(calculateSegments(null).segments, 0);
    assert.equal(calculateSegments(undefined).segments, 0);
  });

  it('fits 160 characters in a single segment', () => {
    const result = calculateSegments('a'.repeat(160));
    assert.equal(result.encoding, ENCODING.GSM);
    assert.equal(result.segments, 1);
    assert.equal(result.remainingInSegment, 0);
  });

  it('drops to 153 per part the moment concatenation is needed', () => {
    // 161 does not fit in one segment, and concatenated parts carry a header,
    // so the limit per part falls to 153 rather than staying at 160.
    assert.equal(calculateSegments('a'.repeat(161)).segments, 2);
    assert.equal(calculateSegments('a'.repeat(306)).segments, 2); // 2 x 153
    assert.equal(calculateSegments('a'.repeat(307)).segments, 3);
    assert.equal(calculateSegments('a'.repeat(459)).segments, 3); // 3 x 153
    assert.equal(calculateSegments('a'.repeat(460)).segments, 4);
  });

  it('charges two septets for GSM-7 extension characters', () => {
    // The euro sign is escape-prefixed on the wire, so it costs double.
    const euro = calculateSegments('€');
    assert.equal(euro.encoding, ENCODING.GSM);
    assert.equal(euro.units, 2);

    // 80 euro signs is 160 septets — exactly one segment, despite being
    // only 80 characters long.
    assert.equal(calculateSegments('€'.repeat(80)).segments, 1);
    assert.equal(calculateSegments('€'.repeat(81)).segments, 2);
  });

  it('reports how much room is left', () => {
    assert.equal(calculateSegments('a'.repeat(150)).remainingInSegment, 10);
  });
});

describe('UCS-2 segmentation', () => {
  it('switches encoding on any non-GSM character', () => {
    // Emoji, em dash, curly quote, CJK — all outside GSM 03.38. The curly
    // quote in particular is what word processors silently substitute for a
    // straight quote, doubling the cost of a message nobody edited.
    for (const character of ['🙏', '—', '”', '日', 'ç̧']) {
      assert.equal(
        calculateSegments(`Hi ${character}`).encoding,
        ENCODING.UCS2,
        `U+${character.codePointAt(0).toString(16).toUpperCase()} should force UCS-2`,
      );
    }
  });

  it('keeps straight quotes and other GSM-7 punctuation cheap', () => {
    // The straight quote IS in GSM 03.38 — only the curly form is not.
    assert.equal(calculateSegments('He said "hi"').encoding, ENCODING.GSM);
    assert.equal(calculateSegments("It's fine").encoding, ENCODING.GSM);
  });

  it('uses 70 and 67 as its limits', () => {
    const emoji = '🙏';
    // The emoji is a surrogate pair: 68 + 2 = 70 UTF-16 units exactly.
    assert.equal(calculateSegments(`${'a'.repeat(68)}${emoji}`).units, 70);
    assert.equal(calculateSegments(`${'a'.repeat(68)}${emoji}`).segments, 1);
    assert.equal(calculateSegments(`${'a'.repeat(69)}${emoji}`).segments, 2);
  });

  it('counts astral-plane characters as two UTF-16 units', () => {
    // This is how carriers bill them, and getting it wrong halves the estimate.
    assert.equal(calculateSegments('🙏').units, 2);
    assert.equal(calculateSegments('🙏🙏🙏').units, 6);
  });

  it('bills a long unicode message far above the naive estimate', () => {
    const body = `${'a'.repeat(199)}🙏`;
    const result = calculateSegments(body);

    assert.equal(result.units, 201);
    // A naive ceil(201/160) would bill 2. The correct answer is ceil(201/67).
    assert.equal(result.segments, 3);
    assert.notEqual(result.segments, Math.ceil(201 / 160));
  });

  it('rolls into another segment one unit past an exact multiple', () => {
    assert.equal(calculateSegments(`${'a'.repeat(199)}🙏`).segments, 3); // 201 = 3 x 67
    assert.equal(calculateSegments(`${'a'.repeat(200)}🙏`).segments, 4); // 202
  });
});

describe('encoding diagnostics', () => {
  it('names the characters that forced UCS-2', () => {
    assert.deepEqual(findNonGsmCharacters('Hello 🙏 world'), ['🙏']);
    assert.deepEqual(findNonGsmCharacters('plain ascii'), []);
  });

  it('deduplicates repeated offenders', () => {
    assert.deepEqual(findNonGsmCharacters('🙏🙏🙏'), ['🙏']);
  });

  it('does not flag legitimate GSM-7 extension characters', () => {
    assert.deepEqual(findNonGsmCharacters('€{}[]'), []);
  });

  it('answers whether a body fits one segment', () => {
    assert.equal(fitsSingleSegment('a'.repeat(160)), true);
    assert.equal(fitsSingleSegment('a'.repeat(161)), false);
    assert.equal(fitsSingleSegment(`${'a'.repeat(69)}🙏`), false);
  });
});
