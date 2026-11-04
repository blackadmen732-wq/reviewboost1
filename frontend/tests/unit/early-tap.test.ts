import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EARLY_TAP_MARKER_MS,
  EARLY_TAP_MARKER_PREFIX,
  EARLY_TAP_SCRIPT,
  readEarlyTapMarker,
} from "@/features/customer-flow/early-tap";

/**
 * The inline script that makes a star work before the page's JavaScript has
 * loaded. It is plain text in the HTML, so it is run here exactly as a browser
 * would run it: against real form and radio elements.
 */

let removeListener: (() => void) | null = null;

function install() {
  const added: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
  const original = document.addEventListener.bind(document);
  const spy = vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
    added.push([type, listener, options]);
    original(type, listener, options);
  });
  new Function(EARLY_TAP_SCRIPT)();
  spy.mockRestore();
  removeListener = () => {
    for (const [type, listener, options] of added) document.removeEventListener(type, listener, options);
  };
}

function page({ early = true } = {}) {
  document.body.innerHTML = `
    <form method="post" action="/q/tok/rate" ${early ? "data-early-submit" : ""}>
      ${[1, 2, 3, 4, 5].map((n) => `<input type="radio" name="visit-rating" value="${n}" id="r${n}">`).join("")}
    </form>`;
  const form = document.querySelector("form")!;
  const submit = vi.spyOn(form, "submit").mockImplementation(() => {});
  return { form, submit };
}

function tap(rating: number) {
  const input = document.getElementById(`r${rating}`) as HTMLInputElement;
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  window.history.replaceState(null, "", "/q/tok");
  install();
});

afterEach(() => {
  removeListener?.();
  delete window.__rbFlowReady;
  delete window.__rbEarly;
  window.sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("a star tapped before the JavaScript has loaded", () => {
  it("submits the form natively, once", () => {
    const { submit } = page();
    tap(2);
    tap(5);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(window.__rbEarly).toBe(2);
  });

  it("remembers this tab has rated, so the back button cannot rate twice", () => {
    page();
    tap(4);
    expect(readEarlyTapMarker("/q/tok")).toBe(true);
    expect(readEarlyTapMarker("/q/tok", Date.now() + EARLY_TAP_MARKER_MS + 1)).toBe(false);
  });

  it("does nothing once React owns the stars", () => {
    const { submit } = page();
    window.__rbFlowReady = true;
    tap(3);
    expect(submit).not.toHaveBeenCalled();
  });

  it("does nothing for a form that did not ask for it", () => {
    const { submit } = page({ early: false });
    tap(3);
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not resubmit for a tab that already rated, unless the last submit failed", () => {
    window.sessionStorage.setItem(`${EARLY_TAP_MARKER_PREFIX}/q/tok`, String(Date.now()));
    const first = page();
    tap(1);
    expect(first.submit).not.toHaveBeenCalled();

    window.history.replaceState(null, "", "/q/tok?retry=1&rating=1");
    const second = page();
    tap(1);
    expect(second.submit).toHaveBeenCalledTimes(1);
  });

  it("moves between stars on arrow keys without choosing one", () => {
    const { submit } = page();
    const first = document.getElementById("r1") as HTMLInputElement;
    first.focus();
    // A real browser checks the next radio on an arrow and fires change; the
    // script must stop that before it happens, so nothing is submitted.
    const arrow = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    first.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("r2");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(document.activeElement?.id).toBe("r2");
    expect(submit).not.toHaveBeenCalled();
    expect([1, 2, 3, 4, 5].some((n) => (document.getElementById(`r${n}`) as HTMLInputElement).checked)).toBe(false);
  });

  it("chooses the focused star on Enter", () => {
    const { submit } = page();
    const fourth = document.getElementById("r4") as HTMLInputElement;
    fourth.focus();
    fourth.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(window.__rbEarly).toBe(4);
  });

  it("stays small and has no request data in it", () => {
    // Under 1 KB: the keyboard handling (arrows move, Enter chooses) took it
    // past the old 800-character budget.
    expect(EARLY_TAP_SCRIPT.length).toBeLessThan(1000);
    expect(EARLY_TAP_SCRIPT).not.toMatch(/token|key=/i);
  });
});
