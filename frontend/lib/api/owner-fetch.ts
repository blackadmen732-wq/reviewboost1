"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * A fetch to the owner API, as the signed-in owner.
 *
 * `requireUser` accepts a Bearer session token and nothing else — no cookie —
 * so a bare `fetch("/api/v1/…")` from the browser is always a 401. That is how
 * the Customer Page editor came to load no draft, fail every upload and never
 * publish, while its tests (which stub `fetch`) passed.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your session expired. Sign in again, then try.");
    this.name = "SessionExpiredError";
  }
}

export async function ownerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();
  if (!session) throw new SessionExpiredError();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(path, { ...init, headers });
}
