import { AlertCircle, Check, QrCode } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils/cn";

/**
 * The answer to "is my business okay?", before anything else on the screen.
 *
 * WHY THIS REPLACED THE AVERAGE RATING AS THE HEADLINE
 * ---------------------------------------------------
 * An average is a vanity metric. It moves slowly, it is the same number today
 * as yesterday, and knowing it changes nothing about what an owner does next.
 * Leading with it made the screen look impressive and answer the wrong
 * question.
 *
 * A busy owner opening this between customers is asking two things: *did
 * anything go wrong*, and *do I need to do something*. So the top of the screen
 * answers exactly that, in one sentence, in one colour.
 *
 * Green with a tick is the most common state and it is a real answer, not an
 * empty state. "Nothing needs you" is worth the whole banner — it is what most
 * people came to find out, and it lets them close the app and get back to work.
 * A product that respects that earns being opened again tomorrow.
 *
 * Only one problem is ever shown, the most urgent. Two warnings is a list, and
 * a list is homework.
 */

type Status =
  | { kind: "setup"; href: string }
  | { kind: "unread"; count: number; href: string }
  | { kind: "quiet"; href: string }
  | { kind: "ok" };

export function StatusBanner({ status }: { status: Status }) {
  if (status.kind === "ok") {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-[var(--radius-card)] border border-brand bg-brand-soft p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand">
          <Check className="size-5 text-on-brand" strokeWidth={3} aria-hidden="true" />
        </span>
        <div>
          <p className="text-base font-semibold text-ink">All good</p>
          <p className="text-sm text-muted">Nothing needs you right now.</p>
        </div>
      </div>
    );
  }

  const content = {
    // The worst state, and the one an owner cannot see for themselves: their
    // code is printed and it does not work.
    setup: {
      title: "Your code is not working yet",
      body: "Add your Google link so customers can leave reviews.",
      action: "Finish setup",
      icon: AlertCircle,
    },
    unread: {
      title:
        status.kind === "unread" && status.count === 1
          ? "1 customer left you a message"
          : `${status.kind === "unread" ? status.count : 0} customers left you messages`,
      body: "Read them and sort out anything that went wrong.",
      action: "Read now",
      icon: AlertCircle,
    },
    // Not framed as a failure. A quiet week is usually a code nobody can see,
    // and the fix is physical, not digital.
    quiet: {
      title: "No scans this week",
      body: "Is your code somewhere customers will see it?",
      action: "See my codes",
      icon: QrCode,
    },
  }[status.kind];

  const Icon = content.icon;

  return (
    <Link
      href={status.href}
      className={cn(
        "mb-6 flex items-center gap-3 rounded-[var(--radius-card)] border p-4",
        "border-[color:var(--rb-star)] bg-[color:var(--rb-star)]/10",
        "transition-transform duration-150 active:scale-[0.99] motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[color:var(--rb-star)]/25">
        <Icon className="size-5 text-[color:var(--rb-warning)]" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">{content.title}</p>
        <p className="text-sm text-muted">{content.body}</p>
      </div>

      <span className="shrink-0 text-sm font-semibold text-brand-text">{content.action}</span>
    </Link>
  );
}
