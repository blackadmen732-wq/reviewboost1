import { useSyncExternalStore } from "react";

/**
 * Whether the app can reach ReviewBoost, learned from the app's own requests:
 * a request that could not reach the server at all means offline; any answer
 * at all means online. React Native has no `navigator.onLine`, and a network
 * library would mean a new native module for one boolean.
 *
 * While offline it looks every few seconds (a tiny request for robots.txt,
 * whose answer, whatever it is, proves the connection), so the app notices
 * the connection coming back by itself rather than on the owner's next tap.
 * Screens that failed to load try again the moment it does (`useAutoRetry`).
 */

const PROBE_EVERY_MS = 5_000;
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

let offline = false;
let probe: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const backOnline = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** A request could not reach the server: no answer at all. */
export function reportUnreachable(): void {
  if (offline) return;
  offline = true;
  emit();
  scheduleProbe();
}

/** Any answer from the server, even an error, proves the connection. */
export function reportReachable(): void {
  if (!offline) return;
  offline = false;
  if (probe) clearTimeout(probe);
  probe = undefined;
  emit();
  for (const listener of backOnline) listener();
}

function scheduleProbe() {
  if (probe || !API_URL) return;
  probe = setTimeout(() => {
    probe = undefined;
    if (!offline) return;
    fetch(`${API_URL}/robots.txt`, { method: "HEAD" }).then(
      () => reportReachable(),
      () => scheduleProbe(),
    );
  }, PROBE_EVERY_MS);
}

/** A dropped connection, as fetch reports one: a TypeError, not an answer. */
export function isUnreachable(caught: unknown): boolean {
  return caught instanceof TypeError;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isOnline(): boolean {
  return !offline;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, isOnline);
}

/** Called once each time the connection comes back. */
export function onBackOnline(listener: () => void): () => void {
  backOnline.add(listener);
  return () => backOnline.delete(listener);
}

/** For tests: online again, with nothing waiting. */
export function resetConnection(): void {
  offline = false;
  if (probe) clearTimeout(probe);
  probe = undefined;
  emit();
}
