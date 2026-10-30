/**
 * The Feedback badge, remembered between screens in this browser tab.
 *
 * A screen still loading (its loading.tsx, an error boundary) has no count to
 * give the nav, and the badge used to vanish for that moment and come back:
 * a number that blinks on every tap reads as a number that cannot be trusted.
 * While a screen has no count, the last one a real screen gave is shown.
 *
 * Browser only. On the server this module is shared by every request, so it
 * neither stores nor returns anything there: one business's count must never
 * be drawn for another.
 */
let remembered: number | null = null;

export function badgeCount(count: number | undefined): number {
  if (typeof window === "undefined") return count ?? 0;
  if (count !== undefined) remembered = count;
  return count ?? remembered ?? 0;
}
