import { supabase } from "./supabase";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
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
  if (!API_URL) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured", 0);
  }

  if (!orgId) {
    throw new ApiError("No organization selected", 0);
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new ApiError(
      error?.message ?? "Not authenticated — please sign in",
      401,
    );
  }

  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${data.session.access_token}`,
    "X-Organization-Id": orgId,
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };

  const res = await fetch(url, { ...init, headers });
  const body = await res.json().catch(() => null);
  const requestId = (body as Record<string, unknown>)?.requestId as
    | string
    | undefined;

  if (!res.ok) {
    const err = (body as Record<string, unknown>)?.error;
    const message =
      (err && typeof err === "object" && (err as Record<string, unknown>).message) ??
      (typeof err === "string" && err) ??
      (body as Record<string, unknown>)?.message ??
      res.statusText;
    throw new ApiError(String(message), res.status, requestId);
  }

  return body as T;
}
