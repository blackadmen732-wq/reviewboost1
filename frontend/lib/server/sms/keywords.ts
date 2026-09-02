import "server-only";

/**
 * Inbound keyword classification for STOP / START / HELP.
 *
 * The whole surface area for compliance keywords, kept deliberately small and
 * exact. Normalisation is limited to case and whitespace and punctuation that a
 * human or a carrier realistically varies — never fuzzy matching. Fuzzy matching
 * here is dangerous in both directions: a false STOP silently blocks a customer
 * who wanted to reply, and a missed STOP keeps texting someone who asked to
 * stop. So a keyword is recognised only as the first word (or first two words,
 * for "OPT OUT"), matched exactly against a fixed list.
 *
 * This is technical compliance plumbing, not a claim of legal certification.
 */

export type KeywordIntent = "stop" | "start" | "help" | "none";

// Single-word keywords, in canonical UPPERCASE alphanumeric form.
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT"]);
const START_WORDS = new Set(["START", "YES", "UNSTOP", "SUBSCRIBE", "OPTIN"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

// Two-word forms that collapse to a single-word keyword ("OPT OUT" → OPTOUT).
const TWO_WORD: Record<string, KeywordIntent> = {
  "OPT OUT": "stop",
  "OPT IN": "start",
};

function intentOf(word: string): KeywordIntent {
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return "none";
}

/**
 * Classify an inbound message body.
 *
 * Normalisation: Unicode NFC, uppercased, every run of non-alphanumeric
 * characters (spaces, punctuation, hyphens) treated as a single separator. The
 * first token decides; the first two tokens are also checked for the "OPT OUT" /
 * "OPT IN" forms. Extra words after the keyword ("STOP please") do not change
 * the result, and a keyword buried later in a sentence does not trigger.
 */
export function classifyKeyword(body: string | null | undefined): KeywordIntent {
  if (!body) return "none";

  const tokens = body
    .normalize("NFC")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return "none";

  const first = tokens[0]!;
  if (tokens.length >= 2) {
    const twoWord = TWO_WORD[`${first} ${tokens[1]}`];
    if (twoWord) return twoWord;
  }

  return intentOf(first);
}
