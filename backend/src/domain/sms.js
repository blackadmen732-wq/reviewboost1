/**
 * SMS encoding and segmentation.
 *
 * Carriers bill per *segment*, not per message, and the segment size depends on
 * which alphabet the message needs. Getting this wrong is not cosmetic: a naive
 * `length / 160` under-counts every message containing a single emoji, which
 * means under-billing on a large fraction of real traffic, forever.
 *
 *   GSM-7   160 characters in a single message, 153 per part once concatenated
 *   UCS-2    70 characters in a single message,  67 per part once concatenated
 *
 * The drop from 160 to 153 (and 70 to 67) is the User Data Header that carriers
 * prepend to each part so the handset can reassemble them.
 *
 * One character outside the GSM-7 alphabet — any emoji, curly quote, or em
 * dash — forces the entire message to UCS-2 and less than half the capacity.
 */

/** The GSM 03.38 basic character set. One septet each. */
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);

/**
 * The GSM 03.38 extension table. Each costs *two* septets, because it is
 * transmitted as an escape character followed by the symbol.
 */
const GSM_EXTENDED = new Set('^{}\\[~]|€');

export const GSM_SINGLE_LIMIT = 160;
export const GSM_CONCAT_LIMIT = 153;
export const UCS2_SINGLE_LIMIT = 70;
export const UCS2_CONCAT_LIMIT = 67;

export const ENCODING = Object.freeze({ GSM: 'GSM-7', UCS2: 'UCS-2' });

/**
 * @typedef {object} SegmentInfo
 * @property {'GSM-7'|'UCS-2'} encoding
 * @property {number} units      billable units — septets for GSM-7, UTF-16 code units for UCS-2
 * @property {number} segments   how many messages the carrier will actually bill
 * @property {number} singleLimit
 * @property {number} multipartLimit
 * @property {number} remainingInSegment  units left before another segment is charged
 */

/**
 * @param {string} message
 * @returns {SegmentInfo}
 */
export function calculateSegments(message) {
  const text = String(message ?? '');

  let septets = 0;
  let isGsm = true;

  // Iterating with for..of walks code points, so an astral-plane emoji is seen
  // as one character here — correct for deciding the alphabet.
  for (const character of text) {
    if (GSM_BASIC.has(character)) {
      septets += 1;
    } else if (GSM_EXTENDED.has(character)) {
      septets += 2;
    } else {
      isGsm = false;
      break;
    }
  }

  // UCS-2 is billed in UTF-16 code units, so that same emoji counts as two.
  // `String.prototype.length` is already a UTF-16 code unit count.
  const units = isGsm ? septets : text.length;
  const singleLimit = isGsm ? GSM_SINGLE_LIMIT : UCS2_SINGLE_LIMIT;
  const multipartLimit = isGsm ? GSM_CONCAT_LIMIT : UCS2_CONCAT_LIMIT;

  let segments;
  if (units === 0) segments = 0;
  else if (units <= singleLimit) segments = 1;
  else segments = Math.ceil(units / multipartLimit);

  const capacity = segments <= 1 ? singleLimit : segments * multipartLimit;

  return {
    encoding: isGsm ? ENCODING.GSM : ENCODING.UCS2,
    units,
    segments,
    singleLimit,
    multipartLimit,
    remainingInSegment: Math.max(0, capacity - units),
  };
}

/** Characters that forced the message out of GSM-7, for a "why is this expensive?" hint. */
export function findNonGsmCharacters(message) {
  const offenders = new Set();

  for (const character of String(message ?? '')) {
    if (!GSM_BASIC.has(character) && !GSM_EXTENDED.has(character)) {
      offenders.add(character);
    }
  }

  return [...offenders];
}

/** True when the message fits in a single billable segment. */
export function fitsSingleSegment(message) {
  return calculateSegments(message).segments <= 1;
}
