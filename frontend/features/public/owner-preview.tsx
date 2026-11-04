import { ChevronRight, Star } from "lucide-react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { Stars } from "@/components/ui/stars";
import { PhoneFrame } from "@/features/customer-page/phone-frame";

/**
 * What an owner sees on their phone, drawn with the owner app's own pieces
 * (the state line, the headline, the number tile, the rating rows) and
 * labelled as an example. It is a picture of the screen, not anyone's data:
 * the page says "Example" beside it, and nothing here is presented as a
 * count of real ratings.
 */
const ROWS = [
  { rating: 5, when: "Today", unread: true },
  { rating: 2, when: "Today", unread: true },
  { rating: 5, when: "Yesterday", unread: false },
] as const;

export function OwnerPreview() {
  return (
    <figure className="owner-preview">
      <PhoneFrame label="Example of the ReviewBoost Home screen">
        <div className="flex h-full flex-col bg-canvas px-6 pt-16 text-ink">
          <div className="flex items-center justify-between">
            <ReviewBoostLogo pose="full" size="poweredBy" />
            <span className="text-sm text-muted">Settings</span>
          </div>
          <p className="mt-7 text-[1.65rem] font-semibold tracking-[-0.02em]">Your Pizza Shop</p>
          <p className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-muted">
            <span aria-hidden="true" className="size-2 rounded-full bg-star" />
            Needs you
          </p>
          <p className="mt-2 text-[2rem] font-semibold leading-[1.1] tracking-[-0.035em]">2 new ratings</p>
          <p className="mt-2 text-base text-muted">1 is 3 stars or fewer. See it before the next rush.</p>
          <span className="mt-5 flex min-h-12 items-center justify-center rounded-[var(--radius-control)] bg-action text-base font-semibold text-on-action">
            Read feedback
          </span>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3.5">
              <p className="text-sm font-medium text-muted">This week</p>
              <p className="mt-2 text-[2.1rem] font-semibold leading-none tabular-nums">12</p>
              <p className="mt-1 text-sm font-medium">ratings</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3.5">
              <p className="text-sm font-medium text-muted">Last 30 days</p>
              <p className="mt-2 flex items-center gap-1 text-[2.1rem] font-semibold leading-none tabular-nums">
                4.6 <Star aria-hidden="true" className="size-6 fill-star text-star" strokeWidth={0} />
              </p>
              <p className="mt-1 text-sm font-medium">average</p>
            </div>
          </div>
          <p className="mt-5 text-sm font-medium text-muted">Unread feedback</p>
          <ul className="mt-1 divide-y divide-border border-y border-border">
            {ROWS.map((row, index) => (
              <li key={index} className="flex min-h-12 items-center gap-3">
                <span className="w-2">{row.unread ? <span className="block size-2 rounded-full bg-action" /> : null}</span>
                <Stars rating={row.rating} size="md" />
                <span className={row.unread ? "ml-auto text-sm font-medium" : "ml-auto text-sm text-muted"}>{row.when}</span>
                <ChevronRight aria-hidden="true" className="size-4 text-muted" />
              </li>
            ))}
          </ul>
        </div>
      </PhoneFrame>
      <figcaption className="mt-3 text-center text-sm text-muted">Example · Home on the owner&rsquo;s phone</figcaption>
    </figure>
  );
}
