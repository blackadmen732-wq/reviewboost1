"use client";

import { useEffect } from "react";

import { SETUP_SEEN_COOKIE } from "@/features/dashboard/setup-seen-cookie";

/**
 * Remembers the steps shown as done, so Home can tell a step finished since
 * the last visit (its tick draws, once) from one that was already done (it is
 * simply there). Only step keys, only in this browser, only for Home.
 */
export function SetupSeen({ done }: { done: readonly string[] }) {
  const value = done.join(",");
  useEffect(() => {
    document.cookie = `${SETUP_SEEN_COOKIE}=${encodeURIComponent(value)}; path=/home; max-age=31536000; samesite=lax`;
  }, [value]);
  return null;
}
