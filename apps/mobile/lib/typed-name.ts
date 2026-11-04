/**
 * Whether what someone typed is the name asked for: case, surrounding spaces,
 * runs of spaces and curly versus straight quotes do not count. An iPhone
 * types ’ for ' (Smart Punctuation), so "Rosa’s Hair Studio" never matched a
 * name saved as "Rosa's Hair Studio", and the Delete button stayed grey.
 *
 * The same rules, under the same name, as the website's
 * frontend/lib/utils/typed-name.ts. Once it matches, the business's own name
 * is what is sent, so the database's exact lower(btrim()) check passes.
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
