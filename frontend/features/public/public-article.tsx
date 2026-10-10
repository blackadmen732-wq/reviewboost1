import type { ReactNode } from "react";

import { PublicShell } from "@/features/public/public-shell";

/**
 * Every public page that is a document rather than a landing page: how it
 * works, Tags, Integrity, Security, Privacy, Terms, delete account, goodbye.
 *
 * It keeps the 40rem reading column — that is a measure, not a style choice —
 * but takes the same opening as the home page: an optional tracked-caps
 * eyebrow over a display heading, and enough air above it that the page
 * starts rather than merely continuing under the bar. Eight pages, one edit.
 *
 * `eyebrow` is for the three marketing pages. Terms and Privacy are legal
 * documents and get none.
 */
export function PublicArticle({
  title,
  lede,
  eyebrow,
  children,
}: {
  title: string;
  lede?: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <article className="mx-auto w-full max-w-[40rem] px-5 pb-28 pt-20 sm:px-8 sm:pb-36 sm:pt-28">
        {eyebrow ? <p className="rb-eyebrow mb-6">{eyebrow}</p> : null}
        <h1 className="text-[clamp(2.1rem,4.2vw,3.1rem)] font-bold leading-[1.04] tracking-[-0.04em] text-ink">
          {title}
        </h1>
        {lede ? (
          <p className="mt-5 max-w-[40ch] text-lg leading-relaxed text-muted sm:text-xl">{lede}</p>
        ) : null}
        <div className="mt-12 flex flex-col gap-5 text-base leading-relaxed text-ink [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_p]:max-w-[42ch] [&_p]:text-muted">
          {children}
        </div>
      </article>
    </PublicShell>
  );
}
