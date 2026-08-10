"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * Deliberately after `load`, so it never competes with the first paint for
 * bandwidth. The app works identically without it — the worker only adds
 * offline tolerance and faster repeat launches, so a failed registration is
 * logged nowhere and breaks nothing.
 *
 * Skipped in development, where a stale worker serving old bundles is a
 * genuinely confusing way to lose an afternoon.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Registration fails on unsupported browsers and in some private
        // modes. That is a normal state, not an error worth surfacing.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
