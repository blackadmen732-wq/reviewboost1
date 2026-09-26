import { PhoneFrame } from "@/features/customer-page/phone-frame";

/**
 * Text Requests, shown as the message a customer actually receives.
 *
 * The wording is the composer's real default template
 * (`text-request-composer.tsx`), not an invented example — a customer who
 * didn't tap the Tag on their way out can still get the same link by text.
 *
 * Reverse composition to the Home section above it: the phone leads on the
 * left, the explanation follows on the right.
 */
export function TextRequestSection() {
  return (
    <div className="grid items-center gap-12 md:grid-cols-12 md:gap-12">
      <div className="mx-auto w-full max-w-[280px] md:col-span-5 md:max-w-[300px]">
        <PhoneFrame label="A text message from the business with a ReviewBoost link">
          <div className="flex h-full flex-col bg-[#f2f3f5] font-sans">
            <div className="flex flex-col items-center gap-1 border-b border-black/5 bg-white/80 pb-3 pt-12">
              <span className="grid size-10 place-items-center rounded-full bg-[#d7dbe0] text-sm font-semibold text-[#3a3f45]">
                MP
              </span>
              <span className="text-xs font-medium text-[#1c1c1e]">Mario&apos;s Pizza</span>
            </div>
            <div className="flex flex-1 flex-col gap-2 px-3 pt-5">
              <p className="self-center text-[10px] font-medium text-[#8e8e93]">Today 6:42 PM</p>
              <div className="max-w-[82%] rounded-[18px] rounded-bl-[6px] bg-white px-3.5 py-2.5 text-[13px] leading-snug text-[#1c1c1e] shadow-[0_1px_1px_rgb(0_0_0/6%)]">
                How was your visit? Tap here to leave a review:{" "}
                <span className="text-[#0a66d8] underline">reviewboost.fit/q/8f3k2p</span>
              </div>
              {/* The link preview a phone draws for the link: the business's
                  own customer page, which is where the tap goes. */}
              <div className="max-w-[82%] overflow-hidden rounded-[18px] rounded-bl-[6px] bg-white shadow-[0_1px_1px_rgb(0_0_0/6%)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- decorative sample artwork inside a picture */}
                <img
                  src="/images/showcase/pizza-hero.png"
                  alt=""
                  className="aspect-[1.6] w-full object-cover"
                />
                <div className="px-3.5 py-2.5">
                  <p className="text-[12px] font-semibold leading-tight text-[#1c1c1e]">
                    How was your visit?
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#8e8e93]">reviewboost.fit</p>
                </div>
              </div>
            </div>
            <div className="mx-3 mb-6 mt-auto rounded-full border border-black/10 bg-white px-4 py-2 text-[12px] text-[#8e8e93]">
              Text Message
            </div>
          </div>
        </PhoneFrame>
      </div>

      <div className="md:col-span-6 md:col-start-7">
        <p className="text-sm font-semibold text-brand-text">Text Requests</p>
        <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.03em] text-ink">
          Didn&apos;t tap on the way out? Text them the same link.
        </h2>
        <p className="mt-5 max-w-[40ch] text-lg leading-relaxed text-muted">
          Send a customer&apos;s number a text carrying the same ReviewBoost link every Tag
          uses — no separate flow, no different link to keep straight.
        </p>
        <p className="mt-4 max-w-[40ch] text-base leading-relaxed text-muted">
          Every plan includes a monthly allowance of texts. They arrive with each paid month and
          do not roll over.
        </p>
      </div>
    </div>
  );
}
