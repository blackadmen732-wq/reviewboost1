/**
 * Stars that work before the page's JavaScript has arrived.
 *
 * On a busy cellular connection the customer page's HTML shows the stars about
 * two seconds before React is ready to answer a tap. A tap in that window used
 * to do nothing, and the customer tapped again or gave up. Now the stars sit
 * in a real form: this small script, inlined in the HTML so it runs the moment
 * the page is parsed, submits that form natively on the first star chosen. The
 * server saves the rating and hands off to Google in one round trip
 * (`/q/[token]/rate`).
 *
 * Once React is ready (`window.__rbFlowReady`) the script steps aside and the
 * full flow — offline hold, retry with the same idempotency key, the handoff
 * screen — takes every tap. A marker in sessionStorage (the same store the
 * flow already uses for back-button recovery, never a cookie) stops a customer
 * who comes back with the back button from rating twice.
 */

export const EARLY_TAP_MARKER_PREFIX = "reviewboost:customer-early:";

/** How long a native submit counts as "already rated" for back-button returns. */
export const EARLY_TAP_MARKER_MS = 30 * 60 * 1000;

declare global {
  interface Window {
    /** Set by CustomerFlow once React owns the stars. */
    __rbFlowReady?: boolean;
    /** The rating the early script submitted natively, if it did. */
    __rbEarly?: number;
  }
}

/**
 * The inline script. ES5, no dependencies, ~600 bytes. It only ever acts on a
 * form marked `data-early-submit`, only before React is ready, and only once.
 * A `retry` in the URL means the last submit failed, so the marker is ignored.
 *
 * Arrow keys only move between stars, never choose one: a radio group checks
 * the next radio on an arrow, which here would submit it (WCAG 3.2.2). Enter
 * chooses the focused star; Space already does. VisitStars does the same once
 * React is ready.
 */
export const EARLY_TAP_SCRIPT = `(function(){var P=${JSON.stringify(EARLY_TAP_MARKER_PREFIX)},M=${EARLY_TAP_MARKER_MS};document.addEventListener("keydown",function(e){var t=e.target,k=e.key;if(window.__rbFlowReady||!t||t.name!=="visit-rating")return;var r=document.getElementsByName("visit-rating"),d=k=="ArrowRight"||k=="ArrowDown"?1:k=="ArrowLeft"||k=="ArrowUp"?-1:0,n=r[[].indexOf.call(r,t)+d];if(d){e.preventDefault();if(n)n.focus()}else if(k=="Enter"){e.preventDefault();t.click()}},true);document.addEventListener("change",function(e){var t=e.target;if(window.__rbFlowReady||window.__rbEarly||!t||t.name!=="visit-rating")return;var f=t.form;if(!f||!f.hasAttribute("data-early-submit"))return;var k=P+location.pathname;try{var a=Number(sessionStorage.getItem(k));if(a&&Date.now()-a<M&&location.search.indexOf("retry=")<0)return;sessionStorage.setItem(k,String(Date.now()))}catch(x){}window.__rbEarly=Number(t.value);f.submit()},true)})();`;

function markerKey(pathname: string): string {
  return `${EARLY_TAP_MARKER_PREFIX}${pathname}`;
}

/** True when this tab already rated through the early form in the last 30 minutes. */
export function readEarlyTapMarker(pathname: string, now: number = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const at = Number(window.sessionStorage.getItem(markerKey(pathname)));
    return Number.isFinite(at) && at > 0 && now - at < EARLY_TAP_MARKER_MS;
  } catch {
    return false;
  }
}

/** Forget the marker: the submit it stands for failed and the customer is retrying. */
export function clearEarlyTapMarker(pathname: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(markerKey(pathname));
  } catch {
    // Storage disabled: there is nothing to clear.
  }
}
