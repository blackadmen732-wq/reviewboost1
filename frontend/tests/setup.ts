import "@testing-library/jest-dom/vitest";
import "vitest-axe/extend-expect";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { apiMockServer } from "@/tests/msw/server";

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
