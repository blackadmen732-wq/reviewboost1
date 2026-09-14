"use client";

import { CheckCircle, Clock, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface TextRequestItem {
  id: string;
  status: string;
  createdAt: string;
  scheduledFor: string | null;
  standLabel: string | null;
}

function statusIcon(status: string) {
  if (status === "delivered" || status === "sent") return <CheckCircle className="size-4 text-green-600" aria-hidden="true" />;
  if (status === "failed" || status === "cancelled") return <XCircle className="size-4 text-red-500" aria-hidden="true" />;
  return <Clock className="size-4 text-amber-500" aria-hidden="true" />;
}

function statusLabel(status: string): string {
  switch (status) {
    case "delivered": return "Delivered";
    case "sent": return "Sent";
    case "scheduled": return "Scheduled";
    case "pending": return "Pending";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

export function TextRequestList({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<TextRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: { session } } = await supabaseBrowser().auth.getSession();
      if (cancelled) return;
      if (!session) { setLoading(false); return; }

      const res = await fetch("/api/v1/text-requests?limit=25", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (cancelled) return;

      if (res.ok) {
        const body = (await res.json()) as { data: { items: TextRequestItem[] } };
        setItems(body.data.items);
      }
      setLoading(false);
    }

    void load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-brand-text" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No text requests yet"
        description="Send your first review request above."
      />
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface">
      <h3 className="border-b border-border px-5 py-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Recent requests
      </h3>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-5 py-3">
            {statusIcon(item.status)}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">
                {statusLabel(item.status)}
              </span>
              {item.standLabel ? (
                <span className="block text-xs text-muted">{item.standLabel}</span>
              ) : null}
            </span>
            <time dateTime={item.createdAt} className="shrink-0 text-xs text-muted">
              {new Date(item.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
