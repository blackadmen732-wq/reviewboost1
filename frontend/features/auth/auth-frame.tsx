import Link from "next/link";
import type { ReactNode } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";

export function AuthFrame({
  children,
  align = "center",
}: {
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="px-5 pt-6 print:hidden sm:px-8">
        <Link
          href="/"
          className="inline-flex rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <ReviewBoostLogo pose="full" size="nav" />
        </Link>
      </header>
      <main
        className={
          align === "center"
            ? "mx-auto flex w-full max-w-md flex-col justify-center px-5 py-12"
            : "mx-auto flex w-full max-w-md flex-col px-5 pb-16 pt-10"
        }
      >
        {children}
      </main>
    </div>
  );
}
