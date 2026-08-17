/*
 * ReviewBoost service worker.
 *
 * WHAT THIS DELIBERATELY DOES NOT CACHE
 * ------------------------------------
 * Nothing under /api/, nothing with an Authorization header, and no HTML for a
 * signed-in page. This is the single most dangerous thing a service worker can
 * get wrong in a multi-tenant product: a cached response is stored per *origin*,
 * not per session, so caching one owner's feedback and replaying it after they
 * sign out — or on a shared device — hands one business another's data. Every
 * strategy below is chosen with that in mind.
 *
 * So the cache holds exactly two things:
 *   - the static build output, which is identical for everyone
 *   - one offline fallback page, which contains no data
 *
 * Everything else goes to the network, every time.
 */

const VERSION = "rb-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline";

// Only assets that are the same for every visitor.
const PRECACHE = [OFFLINE_URL, "/brand/icon-192.png", "/brand/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // Individually, so one missing file does not fail the whole install and
      // leave the app with no service worker at all.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      // Claim immediately so an update takes effect on this load rather than
      // the next one. Two versions running at once is how stale UI meets a new
      // API and produces bugs nobody can reproduce.
      .then(() => self.clients.claim()),
  );
});

function isPrivate(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login") ||
    // The customer flow writes real data and must never be replayed from a
    // cache; a stale token page would show the wrong business.
    url.pathname.startsWith("/q/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET. A cached POST would mean a rating or a note submitted twice, or
  // silently swallowed.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin (Supabase, fonts) is left entirely alone.
  if (url.origin !== self.location.origin) return;

  if (isPrivate(url)) return;

  // Navigations: network first, offline page as the fallback. Never serve a
  // cached page for a signed-in route — the fallback carries no data.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Build output is content-hashed, so a hit is always correct and a miss is
  // fetched and stored. This is what makes a second launch feel instant.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

// Lets a new build tell an open tab to take over without a manual reload.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
