import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";

/**
 * Text Requests, shown as the message a customer actually receives.
 *
 * The wording is the composer's real default template
 * (`text-request-composer.tsx`), not an invented example — a customer who
 * didn't tap the Tag on their way out can still get the same link by text.
 */
export function TextRequestSection() {
  return (
    <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
      <div className="order-2 md:order-1">
        <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">Text Requests</p>
        <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-ink">
          Didn&apos;t tap the Tag on the way out? Text them the link instead.
        </h2>
        <p className="mt-4 max-w-[38ch] text-lg leading-relaxed text-muted">
          Send a customer&apos;s number a text carrying the same ReviewBoost link every Tag
          uses — no separate flow, no different link to keep straight.
        </p>
        <p className="mt-4 max-w-[38ch] text-base leading-relaxed text-muted">
          Every plan includes a monthly allowance of texts. Included texts are used first
          and do not roll over; texts you buy separately never expire.
        </p>
      </div>

      <div className="order-1 flex justify-center md:order-2">
        <div className="w-full max-w-[280px] rounded-[1.75rem] border border-border bg-white p-4 shadow-[0_24px_60px_-24px_rgba(27,67,50,0.25)]">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <ReviewBoostLogo pose="mark" size="nav" />
            <span className="text-sm font-medium text-muted">Message</span>
          </div>
          <div className="mt-4 rounded-2xl rounded-tl-sm bg-quiet p-4">
            <p className="text-sm leading-relaxed text-ink">
              How was your visit? Tap here to leave a review: reviewboost.fit/q/8f3k2p
            </p>
          </div>
          <p className="mt-3 text-right text-xs text-muted">Delivered</p>
        </div>
      </div>
    </div>
  );
}
