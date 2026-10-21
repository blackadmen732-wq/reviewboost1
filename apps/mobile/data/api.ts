import { supabase } from "./supabase";
import { boundedRead, boundedWrite } from "./read-deadline";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
    /** The API's stable error code, e.g. "owns_business". */
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  orgId: string,
  init?: RequestInit,
): Promise<T> {
  if (!orgId) {
    throw new ApiError("No organization selected", 0);
  }
  return send<T>(path, orgId, init);
}

/**
 * For the few calls about the signed-in person rather than a business, such
 * as deleting your own account, which must work with no business at all.
 */
export async function accountFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return send<T>(path, null, init);
}

async function send<T>(
  path: string,
  orgId: string | null,
  init?: RequestInit,
): Promise<T> {
  if (!API_URL) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured", 0);
  }

  const request = async (signal?: AbortSignal): Promise<T> => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      throw new ApiError(
        error?.message ?? "Not authenticated — please sign in",
        401,
      );
    }

    const url = `${API_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(orgId ? { "X-Organization-Id": orgId } : {}),
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    };

    const res = await fetch(url, {
      ...init,
      ...(signal ? { signal } : {}),
      headers,
    });
    const body = await res.json().catch(() => null);
    const requestId = (body as Record<string, unknown>)?.requestId as
      string | undefined;

    if (!res.ok) {
      const err = (body as Record<string, unknown>)?.error;
      const message =
        (err &&
          typeof err === "object" &&
          (err as Record<string, unknown>).message) ??
        (typeof err === "string" && err) ??
        (body as Record<string, unknown>)?.message ??
        res.statusText;
      const code =
        err && typeof err === "object"
          ? ((err as Record<string, unknown>).code as string | undefined)
          : undefined;
      throw new ApiError(String(message), res.status, requestId, code);
    }

    return body as T;
  };
  const method = (init?.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD"
    ? boundedRead(request, init?.signal)
    : boundedWrite(request, init?.signal);
}
