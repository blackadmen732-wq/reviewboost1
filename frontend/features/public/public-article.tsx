import type { ReactNode } from "react";

import { PublicShell } from "@/features/public/public-shell";

export function PublicArticle({
  title,
  lede,
  media,
  children,
}: {
  title: string;
  lede?: string;
  media?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <article className="mx-auto w-full max-w-[40rem] px-5 pb-24 pt-16 sm:px-8 sm:pt-20">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink sm:text-[2rem]">
          {title}
        </h1>
        {lede ? <p className="mt-4 max-w-[40ch] text-lg leading-relaxed text-muted">{lede}</p> : null}
        {media ? <div className="mt-10">{media}</div> : null}
        <div className="mt-10 flex flex-col gap-5 text-base leading-relaxed text-ink [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_p]:max-w-[42ch] [&_p]:text-muted">
          {children}
        </div>
      </article>
    </PublicShell>
  );
}
