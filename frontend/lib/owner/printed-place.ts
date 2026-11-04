/**
 * The place named at the foot of a printed code, or nothing.
 *
 * A Tag's code and its chip open the same page, and so does every Tag at
 * one place, so a business with one place prints no name: any of its sheets
 * works anywhere there. Two or more places can each have their own Google
 * link, so then each sheet says which place it is for. When the count could
 * not be read the name is printed: a name too many costs nothing, and a
 * sheet put up at the wrong place sends customers to the other's Google page.
 */
export function printedPlace(
  placeCount: number | null,
  placeName: string | null,
): string | undefined {
  if (placeCount === 1) return undefined;
  return placeName ?? undefined;
}
