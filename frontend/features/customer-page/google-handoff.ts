declare global {
  interface Window {
    __RB_HANDOFFS__?: string[];
  }
}

/**
 * Leaves the customer page for the business's Google review URL.
 *
 * Production always navigates. Under the development fixture flag a test can
 * install `window.__RB_HANDOFFS__` before the page loads; the URL is recorded
 * and the page stays put so the save that just happened can still be read.
 * Chromium will not let a test replace `Location.assign` itself.
 */
export function handoffToGoogle(url: string): void {
  if (
    process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES === "true" &&
    typeof window !== "undefined" &&
    Array.isArray(window.__RB_HANDOFFS__)
  ) {
    window.__RB_HANDOFFS__.push(url);
    return;
  }

  window.location.assign(url);
}
