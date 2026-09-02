import "server-only";

/**
 * Deterministic SMS segment calculator (GSM 03.38 / UCS-2).
 *
 * The naive `Math.ceil(text.length / 160)` is wrong in three separate ways, and
 * every one of them changes what a message costs:
 *
 *   1. A single non-GSM character (a curly quote, an emoji, an accented letter
 *      outside the basic set) switches the *whole* message to UCS-2, whose
 *      limits are 70 / 67, not 160 / 153.
 *   2. Seven GSM characters — `^ { } \ [ ] ~ | €` — live in an extension table
 *      and each occupy *two* GSM-7 units, not one.
 *   3. `text.length` counts UTF-16 code units, so an emoji (a surrogate pair)
 *      already counts as two before UCS-2's own limits apply.
 *
 * The result is deterministic and side-effect free, which is what makes the
 * cost preview trustworthy and the test vectors meaningful.
 */

// GSM 03.38 basic character set — each is one GSM-7 unit.
const GSM7_BASIC = new Set<string>(
  [
    "@", "£", "$", "¥", "è", "é", "ù", "ì", "ò", "Ç", "\n", "Ø", "ø", "\r", "Å", "å",
    "Δ", "_", "Φ", "Γ", "Λ", "Ω", "Π", "Ψ", "Σ", "Θ", "Ξ", "Æ", "æ", "ß", "É",
    " ", "!", '"', "#", "¤", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", ";", "<", "=", ">", "?",
    "¡", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
    "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "Ä", "Ö", "Ñ", "Ü", "§",
    "¿", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
    "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "ä", "ö", "ñ", "ü", "à",
  ],
);

// GSM 03.38 extension table — each is two GSM-7 units (escape + char).
const GSM7_EXTENSION = new Set<string>(["\f", "^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

export type SmsEncoding = "gsm7" | "ucs2";

// Per-encoding limits: [single-message max, per-segment max when concatenated].
const LIMITS: Record<SmsEncoding, { single: number; concat: number }> = {
  gsm7: { single: 160, concat: 153 },
  ucs2: { single: 70, concat: 67 },
};

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** Encoded units: GSM-7 septets, or UTF-16 code units for UCS-2. */
  unitCount: number;
  segments: number;
  /** Units still free in the final segment (0 when perfectly full). */
  remainingInLastSegment: number;
  /** The single/concat unit limit that applied. */
  perSegment: number;
}

/** Whether every character is representable in GSM-7 (basic or extension). */
function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENSION.has(ch)) return false;
  }
  return true;
}

/** Per-character unit cost for the chosen encoding, in visual-character order. */
function unitCosts(text: string, encoding: SmsEncoding): number[] {
  const costs: number[] = [];
  if (encoding === "gsm7") {
    for (const ch of text) costs.push(GSM7_EXTENSION.has(ch) ? 2 : 1);
  } else {
    // UCS-2 counts UTF-16 code units; a surrogate pair (emoji) is two and must
    // not be split across a segment boundary, so it is one atomic 2-unit char.
    for (const ch of text) costs.push(ch.length >= 2 ? 2 : 1);
  }
  return costs;
}

/**
 * Pack atomic characters into segments without ever splitting a multi-unit
 * character across a boundary. A 2-unit character that will not fit the space
 * left in the current segment starts the next one, leaving a unit unused — which
 * is exactly what real handsets and gateways do.
 */
function packSegments(costs: number[], concatLimit: number): { segments: number; lastUsed: number } {
  let segments = 1;
  let used = 0;
  for (const cost of costs) {
    if (used + cost > concatLimit) {
      segments += 1;
      used = cost;
    } else {
      used += cost;
    }
  }
  return { segments, lastUsed: used };
}

export function computeSegments(text: string): SegmentInfo {
  const encoding: SmsEncoding = isGsm7(text) ? "gsm7" : "ucs2";
  const costs = unitCosts(text, encoding);
  const unitCount = costs.reduce((sum, c) => sum + c, 0);
  const { single, concat } = LIMITS[encoding];

  if (unitCount === 0) {
    return { encoding, unitCount: 0, segments: 1, remainingInLastSegment: single, perSegment: single };
  }

  if (unitCount <= single) {
    return {
      encoding,
      unitCount,
      segments: 1,
      remainingInLastSegment: single - unitCount,
      perSegment: single,
    };
  }

  const { segments, lastUsed } = packSegments(costs, concat);
  return {
    encoding,
    unitCount,
    segments,
    remainingInLastSegment: concat - lastUsed,
    perSegment: concat,
  };
}
