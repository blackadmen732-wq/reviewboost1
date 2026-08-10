/**
 * Dates the way a person says them.
 *
 * "Today" and "Yesterday" beat a date nobody has to decode. Past a week that
 * flips: "23 days ago" is harder to place than "12 Jul", because at that
 * distance people think in dates, not in counts.
 *
 * Rendered on the server, so the string is identical in the HTML and after
 * hydration — which is why call sites pair this with `suppressHydrationWarning`
 * only where the viewer's own locale is genuinely involved.
 */
export function relativeDay(iso: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const days = Math.floor((now - then.getTime()) / 86_400_000);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
