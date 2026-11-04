/**
 * Whether what someone typed is the name asked for: case, surrounding spaces,
 * runs of spaces and curly versus straight quotes do not count. An iPhone
 * types ’ for ' (Smart Punctuation), so "Tony’s Barbers" never matched a name
 * saved as "Tony's Barbers", and the Delete button stayed grey with no hint.
 */
export function sameTypedName(typed: string, name: string): boolean {
  return plain(typed) === plain(name) && plain(name) !== "";
}

function plain(value: string): string {
  return value
    .replace(/[‘’‛ʼ`´]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
