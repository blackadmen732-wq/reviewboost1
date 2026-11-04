import "@testing-library/jest-dom/vitest";
import "vitest-axe/extend-expect";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { apiMockServer } from "@/tests/msw/server";

// Texting ships switched off (lib/features.ts). The suites that exercise it
// run as a deployment that has switched it on; the tests that prove "off"
// switch it off themselves (tests/unit/texting-switch.test.ts).
process.env.NEXT_PUBLIC_TEXTING_ENABLED ??= "true";

// next/font is compiled by Next; under Vitest it is a plain module call.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "", variable: "", style: { fontFamily: "sans-serif" } }),
}));

beforeAll(() => apiMockServer.listen({ onUnhandledRequest: "error" }));

afterAll(() => apiMockServer.close());

afterEach(() => {
  cleanup();
  apiMockServer.resetHandlers();
  window.sessionStorage.clear();
  window.__RB_FIXTURE_CALLS__ = [];
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 0);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
}

Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  }),
});
