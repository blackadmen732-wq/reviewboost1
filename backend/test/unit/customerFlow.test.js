import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_LOCALE,
  MAX_FIRST_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  SUPPORTED_LOCALES,
  byteLength,
  canonicalJson,
  isSupportedLocale,
  normalizeCustomerText,
} from '../../src/domain/customerFlow.js';
import { isValidGoogleReviewUrl } from '../../src/domain/googleReviewUrl.js';

describe('supported locales', () => {
  it('includes the default, so a client is never handed a locale it was not offered', () => {
    assert.ok(SUPPORTED_LOCALES.includes(DEFAULT_LOCALE));
  });

  it('accepts the offered locales and nothing else', () => {
    for (const locale of SUPPORTED_LOCALES) assert.equal(isSupportedLocale(locale), true);
    assert.equal(isSupportedLocale('fr'), false);
    assert.equal(isSupportedLocale('EN'), false);
    assert.equal(isSupportedLocale(''), false);
  });
});

describe('canonicalJson', () => {
  it('treats reordered keys as the same request', () => {
    // A retrying client may serialise the same body with a different key order.
    // Reporting that as an idempotency conflict would break every retry.
    assert.equal(
      canonicalJson({ sessionId: 's', rating: 4 }),
      canonicalJson({ rating: 4, sessionId: 's' }),
    );
  });

  it('sorts nested objects too', () => {
    assert.equal(canonicalJson({ a: { z: 1, y: 2 } }), '{"a":{"y":2,"z":1}}');
  });

  it('keeps array order, because array order is meaningful', () => {
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  });

  it('treats an omitted optional field and an undefined one as identical', () => {
    assert.equal(canonicalJson({ rating: 5 }), canonicalJson({ rating: 5, note: undefined }));
  });

  it('distinguishes a genuinely different payload', () => {
    assert.notEqual(canonicalJson({ rating: 4 }), canonicalJson({ rating: 5 }));
    assert.notEqual(canonicalJson({ note: 'a' }), canonicalJson({ note: 'b' }));
  });
});

describe('normalizeCustomerText', () => {
  it('does not transliterate or strip accents', () => {
    assert.equal(normalizeCustomerText('José'), 'José');
    assert.equal(normalizeCustomerText('Zoë'), 'Zoë');
    assert.equal(normalizeCustomerText('Müller'), 'Müller');
  });

  it('leaves non-Latin scripts alone', () => {
    assert.equal(normalizeCustomerText('田中'), '田中');
    assert.equal(normalizeCustomerText('Ярослав'), 'Ярослав');
  });

  it('normalises to NFC so the same name compares equal however it was typed', () => {
    // "e" + combining acute versus the precomposed character. A phone keyboard
    // and a desktop keyboard genuinely produce different bytes here.
    const decomposed = 'José';
    const precomposed = 'José';
    assert.notEqual(decomposed, precomposed);
    assert.equal(normalizeCustomerText(decomposed), normalizeCustomerText(precomposed));
  });

  it('keeps newlines, because a multi-line note is written on purpose', () => {
    assert.equal(normalizeCustomerText('one\ntwo'), 'one\ntwo');
  });

  it('strips control characters that could spoof how the note is displayed', () => {
    assert.equal(normalizeCustomerText('good\u0000service'), 'goodservice');
    assert.equal(normalizeCustomerText('a\u007Fb'), 'ab');
  });

  it('trims surrounding whitespace without touching the words', () => {
    assert.equal(normalizeCustomerText('  great team  '), 'great team');
  });

  it('handles nothing at all', () => {
    assert.equal(normalizeCustomerText(undefined), '');
    assert.equal(normalizeCustomerText(null), '');
  });
});

describe('byteLength', () => {
  it('counts bytes, not characters', () => {
    // The contract's maxLength counts UTF-16 code units, so a note inside the
    // character limit can still be several times the byte limit.
    assert.equal(byteLength('abc'), 3);
    assert.equal(byteLength('é'), 2);
    assert.equal('🎉'.length, 2);
    assert.equal(byteLength('🎉'), 4);
  });

  it('shows why the two limits are not the same limit', () => {
    const note = '🎉'.repeat(MAX_NOTE_LENGTH / 2);
    assert.equal(note.length, MAX_NOTE_LENGTH);
    assert.ok(byteLength(note) > MAX_NOTE_LENGTH);
  });

  it('bounds a name the same way', () => {
    assert.equal('a'.repeat(MAX_FIRST_NAME_LENGTH).length, MAX_FIRST_NAME_LENGTH);
  });
});

describe('isValidGoogleReviewUrl', () => {
  it('accepts the destinations Google actually issues', () => {
    assert.equal(isValidGoogleReviewUrl('https://g.page/r/CdESAMPLEID/review'), true);
    assert.equal(isValidGoogleReviewUrl('https://maps.app.goo.gl/abc123'), true);
    assert.equal(
      isValidGoogleReviewUrl('https://search.google.com/local/writereview?placeid=ChIJabc'),
      true,
    );
    assert.equal(isValidGoogleReviewUrl('https://www.google.com/maps/place/Cafe'), true);
    assert.equal(isValidGoogleReviewUrl('https://maps.google.com/maps/place/Cafe'), true);
  });

  it('rejects anything that is not Google', () => {
    // This value is handed to a browser, so an unvalidated one turns the
    // business's own printed QR code into a phishing lure.
    assert.equal(isValidGoogleReviewUrl('https://evil.example/review'), false);
    assert.equal(isValidGoogleReviewUrl('https://google.evil.example/maps/'), false);
    assert.equal(isValidGoogleReviewUrl('https://notgoogle.com/maps/'), false);
  });

  it('rejects credentials in the authority, which look like Google and are not', () => {
    assert.equal(isValidGoogleReviewUrl('https://www.google.com@evil.example/maps/'), false);
    assert.equal(isValidGoogleReviewUrl('https://user:pw@www.google.com/maps/'), false);
  });

  it('requires HTTPS', () => {
    assert.equal(isValidGoogleReviewUrl('http://g.page/r/abc/review'), false);
    assert.equal(isValidGoogleReviewUrl('javascript:alert(1)'), false);
    assert.equal(isValidGoogleReviewUrl('data:text/html,x'), false);
  });

  it('rejects a Google host pointed at the wrong page', () => {
    assert.equal(isValidGoogleReviewUrl('https://www.google.com/search?q=cafe'), false);
    assert.equal(isValidGoogleReviewUrl('https://search.google.com/local/writereview'), false);
  });

  it('rejects malformed and empty values without throwing', () => {
    assert.equal(isValidGoogleReviewUrl(''), false);
    assert.equal(isValidGoogleReviewUrl('not a url'), false);
    assert.equal(isValidGoogleReviewUrl(null), false);
    assert.equal(isValidGoogleReviewUrl(undefined), false);
    assert.equal(isValidGoogleReviewUrl(12345), false);
  });
});
