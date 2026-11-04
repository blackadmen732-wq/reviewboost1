"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { ownerFetch } from "@/lib/api/owner-fetch";

/**
 * Opening a rating is reading it.
 *
 * There used to be a "Mark read" button here, beside "Mark as sorted": two
 * status controls on one rating, and the owner had to work out which one made
 * it go away. Every inbox people already use marks a message read when it is
 * opened; this does the same, once, after the screen has drawn. Sorted stays
 * the deliberate decision it was (resolve-button.tsx).
 *
 * In an effect, so a link prefetch never marks anything: only a screen that
 * was actually shown does. A failure is silent and safe — the rating stays
 * unread and is offered again next time.
 */
export function MarkReadOnOpen({ responseId }: { responseId: string }) {
  const router = useRouter();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void (async () => {
      try {
        const response = await ownerFetch(`/api/v1/customer-responses/${responseId}/read`, { method: "POST" });
        if (response.ok) router.refresh();
      } catch {
        // Left unread; nothing the owner needs to act on.
      }
    })();
  }, [responseId, router]);

  return null;
}
