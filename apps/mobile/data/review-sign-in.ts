import { supabase } from "./supabase";

/**
 * App Review's sign-in, from the app's side.
 *
 * Apple's reviewers cannot receive our emailed codes, so the server can be
 * configured with one review address and one code (see
 * frontend/lib/server/review-sign-in.ts). Nothing about that account is in
 * this binary: when the normal email code is rejected, the app asks the server
 * whether this address and code are the review account's, and if they are it
 * gets a one-time token to exchange for an ordinary session.
 *
 * Returns false for every failure — not configured, wrong code, rate limited,
 * offline — so the screen shows the same "that code is not right" either way.
 */
export async function signInForReview(email: string, code: string): Promise<boolean> {
  const api = process.env.EXPO_PUBLIC_API_URL;
  if (!api) return false;
  try {
    const res = await fetch(`${api.replace(/\/+$/, "")}/api/v1/public/review-sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { data?: { tokenHash?: string } } | null;
    const tokenHash = body?.data?.tokenHash;
    if (!tokenHash) return false;
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    return !error;
  } catch {
    return false;
  }
}
