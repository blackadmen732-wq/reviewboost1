"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * The owner's calls to the Connections API. The session token goes in a
 * header, as everywhere else in the owner app; nothing is kept in storage.
 */

export class ConnectionsApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ConnectionsApiError";
  }
}

export async function connectionsApi<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();
  if (!session) throw new ConnectionsApiError("Your session expired. Please sign in again.", "session_expired");

  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new ConnectionsApiError("You seem to be offline. Check your connection and try again.", "network_error");
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; message?: string; details?: Array<{ message?: string }> };
  } | null;

  if (!response.ok) {
    throw new ConnectionsApiError(
      payload?.error?.details?.[0]?.message ?? payload?.error?.message ?? "That did not go through. Please try again.",
      payload?.error?.code ?? `http_${response.status}`,
    );
  }
  return payload?.data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "That did not go through. Please try again.";
}
