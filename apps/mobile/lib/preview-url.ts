/**
 * The owner's look at a Tag's customer page, without being a customer.
 *
 * `?preview=1` makes the page record nothing: no session, so it is not counted
 * as a tap, and a star says "Nothing was saved" instead of saving a rating and
 * going to Google. Only the owner's Preview button opens it this way. The QR
 * code and the link written to a chip stay the plain Tag link
 * (`lib/tag-url.ts` refuses a query on those), so customers never get it.
 *
 * Plain string work rather than URLSearchParams, which React Native's URL
 * has not always implemented; any query already there is kept.
 */
export function customerPagePreviewUrl(tagUrl: string): string {
  const hashAt = tagUrl.indexOf("#");
  const base = hashAt === -1 ? tagUrl : tagUrl.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : tagUrl.slice(hashAt);

  const queryAt = base.indexOf("?");
  if (queryAt === -1) return `${base}?preview=1${hash}`;

  const path = base.slice(0, queryAt);
  const params = base
    .slice(queryAt + 1)
    .split("&")
    .filter((part) => part.length > 0 && part.split("=")[0] !== "preview");
  params.push("preview=1");
  return `${path}?${params.join("&")}${hash}`;
}
