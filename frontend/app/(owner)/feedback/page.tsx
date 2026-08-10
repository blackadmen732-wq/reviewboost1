import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { redirect } from "next/navigation";

import { BottomNav } from "@/features/dashboard/bottom-nav";
import { FeedbackList } from "@/features/dashboard/feedback-list";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Feedback — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * What customers said, newest first.
 *
 * Notes are decrypted on the server and never logged. The rating is shown here
 * because this is the private feedback workspace — the one place an owner is
 * meant to see it. Team Praise deliberately does not.
 */
export default async function FeedbackPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/feedback");

  const { data } = await supabase
    .from("customer_responses")
    .select("id, rating, note_encrypted, submitted_at, read_at")
    .order("submitted_at", { ascending: false })
    .limit(50);

  const { count } = await supabase
    .from("customer_responses")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return (
    <>
      <main className="mx-auto w-full max-w-lg px-5 pb-28 pt-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-[-0.02em] text-ink">Feedback</h1>

        {(data ?? []).length === 0 ? (
          <EmptyFeedback />
        ) : (
          <FeedbackList
            items={(data ?? []).map((row) => ({
              id: row.id as string,
              rating: row.rating as number,
              noteEncrypted: (row.note_encrypted as string | null) ?? null,
              submittedAt: row.submitted_at as string,
              isRead: row.read_at !== null,
            }))}
          />
        )}
      </main>
      <BottomNav unreadCount={count ?? 0} />
    </>
  );
}

function EmptyFeedback() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-quiet">
        <MessageSquare className="size-8 text-muted" aria-hidden="true" />
      </div>
      <p className="text-lg font-semibold text-ink">Nothing yet</p>
      {/* An empty state that explains the cause, not just the absence. */}
      <p className="max-w-[28ch] text-base text-muted">
        When a customer scans your code, what they say shows up here.
      </p>
    </div>
  );
}
