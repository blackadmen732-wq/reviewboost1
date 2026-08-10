import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import { BottomNav } from "@/features/dashboard/bottom-nav";
import { tryDecrypt } from "@/lib/server/crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Praise — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Staff a customer named, deliberately without the rating.
 *
 * The select list below is the privacy barrier, and it is not a convention that
 * can be forgotten: `team_praise_records` has no rating column and there is no
 * join to `customer_responses`, so the star rating is not available to leak.
 *
 * That is the point of the whole feature. An owner deciding whether to
 * recognise someone should be reacting to what a customer wrote about them, not
 * to a number that may have been about the wait or the parking.
 */
export default async function PraisePage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/praise");

  const { data } = await supabase
    .from("team_praise_records")
    .select("id, first_name_encrypted, praise_note_encrypted, status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const items = (data ?? []).map((row) => ({
    id: row.id as string,
    firstName: tryDecrypt(row.first_name_encrypted as string) ?? "Someone",
    note: tryDecrypt(row.praise_note_encrypted as string | null),
    createdAt: row.created_at as string,
  }));

  return (
    <>
      <main className="mx-auto w-full max-w-lg px-5 pb-28 pt-8">
        <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Praise</h1>
        <p className="mb-6 text-base text-muted">Staff your customers named.</p>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-quiet">
              <Sparkles className="size-8 text-muted" aria-hidden="true" />
            </div>
            <p className="text-lg font-semibold text-ink">Nothing yet</p>
            <p className="max-w-[30ch] text-base text-muted">
              When a customer names one of your team, they show up here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-control)]"
              >
                <div className="flex items-center gap-3">
                  {/* The name is the headline. It is the thing the owner is
                      looking for and the only thing they need to act. */}
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-semibold text-brand">
                    {item.firstName.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold text-ink">{item.firstName}</p>
                    <time
                      dateTime={item.createdAt}
                      className="text-sm text-muted"
                      suppressHydrationWarning
                    >
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                      })}
                    </time>
                  </div>
                </div>

                {item.note ? (
                  <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-ink">
                    “{item.note}”
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 ? (
          <p className="mt-6 text-center text-sm leading-relaxed text-muted">
            Matching praise to staff and recording a thank-you is coming next.
          </p>
        ) : null}
      </main>
      <BottomNav />
    </>
  );
}
