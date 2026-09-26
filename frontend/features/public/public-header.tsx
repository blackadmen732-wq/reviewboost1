"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { Button } from "@/components/ui/button";
import { PUBLIC_NAV, START_HREF, SIGN_IN_HREF } from "@/features/public/public-copy";

/**
 * Public header: canvas bar, hairline rule, pill CTA. Mobile collapses nav + sign in + CTA into a toggled panel
 * instead of the old always-visible link wrap, so a phone screen isn't
 * competing with five nav labels above the fold.
 */
export function PublicHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-canvas">
      <div className="mx-auto flex h-20 max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          onClick={() => setOpen(false)}
        >
          <ReviewBoostLogo pose="full" size="nav" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Public">
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href={SIGN_IN_HREF}
            className="text-sm font-medium text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            Sign in
          </Link>
          <Button asChild variant="action" size="sm" className="w-auto rounded-full px-6">
            <Link href={START_HREF}>Get started</Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="public-mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] md:hidden"
        >
          {open ? <X className="size-6" aria-hidden="true" /> : <Menu className="size-6" aria-hidden="true" />}
        </button>
      </div>

      {open ? (
        <nav
          id="public-mobile-nav"
          aria-label="Public"
          className="flex flex-col gap-1 border-t border-border bg-canvas px-5 py-4 md:hidden sm:px-8"
        >
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-full px-3 py-2.5 text-base font-medium text-ink transition-colors hover:bg-quiet"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-4">
            <Link
              href={SIGN_IN_HREF}
              onClick={() => setOpen(false)}
              className="rounded-full px-3 py-2.5 text-base font-medium text-ink transition-colors hover:bg-quiet"
            >
              Sign in
            </Link>
            <Button asChild variant="action" size="default" className="rounded-full">
              <Link href={START_HREF} onClick={() => setOpen(false)}>
                Get started
              </Link>
            </Button>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
