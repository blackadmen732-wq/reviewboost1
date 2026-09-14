"use client";

import { useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/browser";

export function PreviewCustomerPage({ standId }: { standId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPreview() {
    setBusy(true);
    setError(null);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      setError("Sign in again to preview.");
      return;
    }

    try {
      const response = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "omit",
      });
      if (!response.ok) throw new Error("fetch_failed");
      const json = (await response.json()) as { data?: { standUrl?: string } };
      const url = json.data?.standUrl;
      if (!url) throw new Error("no_url");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Could not open the customer page.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void openPreview()}
        disabled={busy}
        className="text-sm font-medium text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:opacity-50"
      >
        {busy ? "Opening preview…" : "Preview customer page"}
      </button>
      {error ? <p className="mt-2 text-sm text-muted">{error}</p> : null}
    </div>
  );
}
