import { PRODUCT } from "@/features/public/public-copy";
import { NfcPuck, TagObject } from "@/features/public/tag-object";

/**
 * The physical product, as objects on a counter.
 *
 * A printed code and a programmed NFC Tag, side by side, carrying the same
 * link. This used to be a looping "tap" animation; it is still now, because
 * the point is the object — and nothing on the page should move forever.
 */
export function TagTapSection() {
  return (
    <div>
      <div className="grid gap-6 md:grid-cols-12 md:items-end">
        <h2 className="text-[clamp(2rem,4vw,3.25rem)] font-bold leading-[1.05] tracking-[-0.035em] text-ink md:col-span-7">
          {PRODUCT.headline}
        </h2>
        <p className="max-w-[40ch] text-lg leading-relaxed text-muted md:col-span-5">{PRODUCT.lede}</p>
      </div>

      {/* The counter: two objects, one link between them. */}
      <div className="relative mt-12 overflow-hidden rounded-[32px] bg-quiet px-6 pb-12 pt-14 sm:px-10 md:mt-16 md:pb-16 md:pt-20">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[38%] border-t border-border bg-[color:var(--rb-surface)]/40"
        />
        <div className="relative flex flex-col items-center justify-center gap-8 sm:flex-row sm:gap-14">
          <div className="-rotate-3">
            <TagObject size="md" />
          </div>
          <p className="flex items-center gap-3 text-sm font-semibold text-muted sm:flex-col">
            <span aria-hidden="true" className="hidden h-px w-16 bg-border sm:block" />
            Same link
            <span aria-hidden="true" className="hidden h-px w-16 bg-border sm:block" />
          </p>
          <div className="rotate-2">
            <NfcPuck />
          </div>
        </div>
      </div>

      <ul className="mt-10 grid gap-8 sm:grid-cols-2 md:mt-12">
        {PRODUCT.items.map((item) => (
          <li key={item.title}>
            <h3 className="text-lg font-semibold tracking-[-0.01em] text-ink">{item.title}</h3>
            <p className="mt-2 max-w-[40ch] text-base leading-relaxed text-muted">{item.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
