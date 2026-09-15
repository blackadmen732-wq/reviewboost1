/**
 * The single place the customer flow leaves ReviewBoost.
 *
 * It exists as its own module so the navigation is one named, testable seam
 * rather than a `window.location` call buried in a component — and so nothing
 * else in the flow can acquire the ability to send a customer somewhere.
 */
export function navigateToDestination(url: string): void {
  if (typeof window === "undefined") return;
  window.location.assign(url);
}
