"use client";

import type { supabaseBrowser as SupabaseBrowser } from "@/lib/supabase/browser";

/**
 * The browser Supabase client, loaded on first use.
 *
 * The sign-in screen only needs Supabase when someone presses a button, and
 * the client is about a quarter of everything the page downloads (~63 KB
 * compressed). Importing it up front made the first screen an owner sees wait
 * for code it might never run. `warmSupabaseBrowser()` fetches it in the
 * background once the page has painted, so a tap on Continue rarely waits.
 */

let loading: Promise<typeof import("@/lib/supabase/browser")> | null = null;

function load() {
  loading ??= import("@/lib/supabase/browser").catch((caught: unknown) => {
    // A failed download (a dropped connection) may be retried on the next tap.
    loading = null;
    throw caught;
  });
  return loading;
}

export async function loadSupabaseBrowser(): Promise<
  ReturnType<typeof SupabaseBrowser>
> {
  const browser = await load();
  return browser.supabaseBrowser();
}

/** Start the download when the browser is idle. Safe to call repeatedly. */
export function warmSupabaseBrowser(): () => void {
  if (typeof window === "undefined") return () => {};
  const start = () => {
    void load().catch(() => {});
  };
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(start, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(start, 600);
  return () => globalThis.clearTimeout(id);
}
