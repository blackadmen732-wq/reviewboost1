"use client";

import Link from "next/link";
import { Smartphone } from "lucide-react";

import { supabaseBrowser } from "@/lib/supabase/browser";

export function PreviewCustomerPage({ standId }: { standId?: string | null } = {}) {
  const handlePreviewQr = async () => {
    if (!standId) return;
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const { data } = (await res.json()) as { data: { url?: string } };
        if (data.url) window.open(data.url, "_blank", "noopener");
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
      <Link
        href="/customer-page"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-[color:var(--rb-border)] bg-white px-4 text-sm font-medium text-[#1a1712] hover:bg-[#faf9f7]"
      >
        <Smartphone className="size-4" aria-hidden="true" />
        Edit customer page
      </Link>
      {standId && (
        <button
          type="button"
          onClick={() => void handlePreviewQr()}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-[color:var(--rb-border)] bg-white px-4 text-sm font-medium text-[#1a1712] hover:bg-[#faf9f7]"
        >
          Preview customer view
        </button>
      )}
    </div>
  );
}
