"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { VisitStars } from "@/features/customer-page/visit-stars";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import { cn } from "@/lib/utils/cn";

/**
 * Fictional demo businesses for the public marketing showcase only.
 *
 * These are presentation data, not product data: no editor, no upload
 * pipeline, no persisted draft. The lower card each phone renders is the
 * real, unmodified `CustomerVisitView` — the same tree the owner preview and
 * live /q page use — so the showcase can never drift from what a customer
 * actually sees. Only the hero artwork changes per business.
 */
const SHOWCASE_BUSINESSES = [
  {
    id: "pizza",
    category: "Pizza",
    name: "Mario's Pizza",
    heroSrc: "/images/showcase/pizza-hero.png",
  },
  {
    id: "barber",
    category: "Barber",
    name: "Elite Cuts",
    heroSrc: "/images/showcase/barber-hero.png",
  },
  {
    id: "salon",
    category: "Beauty",
    name: "Luna Beauty",
    heroSrc: "/images/showcase/salon-hero.png",
  },
  {
    id: "hvac",
    category: "HVAC",
    name: "Arctic Air",
    heroSrc: "/images/showcase/hvac-hero.png",
  },
  {
    id: "auto",
    category: "Auto",
    name: "Prestige Detail",
    heroSrc: "/images/showcase/auto-hero.png",
  },
] as const;

const COUNT = SHOWCASE_BUSINESSES.length;
const messages = customerMessages.en;

/** Shortest signed distance from `active` to `index` around a circle of `length`. */
function circularOffset(index: number, active: number, length: number): number {
  let diff = (index - active + length) % length;
  if (diff > length / 2) diff -= length;
  return diff;
}

function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export function CustomerPageShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const programmaticScroll = useRef(false);

  const active = SHOWCASE_BUSINESSES[activeIndex] ?? SHOWCASE_BUSINESSES[0];

  const goTo = useCallback((index: number) => {
    setActiveIndex(wrap(index, COUNT));
  }, []);

  // Keep the mobile scroller in sync when the active business changes from
  // a source other than the user's own swipe (arrows, dots, category picker).
  useEffect(() => {
    const node = itemRefs.current[activeIndex];
    const scroller = scrollerRef.current;
    if (!node || !scroller) return;
    // jsdom (unit tests) has no scrollTo implementation on Element.
    if (typeof scroller.scrollTo !== "function") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    programmaticScroll.current = true;
    scroller.scrollTo({
      left: node.offsetLeft - scroller.offsetLeft,
      behavior: reducedMotion ? "auto" : "smooth",
    });
    const settle = window.setTimeout(() => {
      programmaticScroll.current = false;
    }, 400);
    return () => window.clearTimeout(settle);
  }, [activeIndex]);

  const handleScroll = useCallback(() => {
    if (programmaticScroll.current) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const center = scroller.scrollLeft + scroller.offsetWidth / 2;
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    itemRefs.current.forEach((node, index) => {
      if (!node) return;
      const nodeCenter = node.offsetLeft - scroller.offsetLeft + node.offsetWidth / 2 + scroller.scrollLeft;
      const distance = Math.abs(nodeCenter - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = index;
      }
    });
    setActiveIndex((current) => (current === closest ? current : closest));
  }, []);

  return (
    <section className="border-t border-border bg-canvas" aria-labelledby="customer-page-showcase-heading">
      <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
        <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">Customer page</p>
        <h2
          id="customer-page-showcase-heading"
          className="mt-4 max-w-[24ch] text-2xl font-bold tracking-[-0.02em] text-ink sm:text-3xl"
        >
          Looks like your business. Works like ReviewBoost.
        </h2>
        <p className="mt-3 max-w-[46ch] text-base leading-relaxed text-muted">
          Every business gets its own visual identity while ReviewBoost keeps the customer interaction simple and
          consistent.
        </p>

        {/* Desktop / tablet: three phones, transform-driven, no re-mount on change. */}
        <div
          className="showcase-track mt-14 hidden md:block"
          role="group"
          aria-roledescription="carousel"
          aria-label="Example ReviewBoost customer pages"
        >
          <div className="relative mx-auto flex h-[620px] max-w-[1100px] items-center justify-center">
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              aria-label="Show previous business"
              className="showcase-arrow showcase-arrow--left"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>

            {SHOWCASE_BUSINESSES.map((biz, index) => {
              const offset = circularOffset(index, activeIndex, COUNT);
              const isActive = offset === 0;
              const isSide = Math.abs(offset) === 1;
              return (
                <div
                  key={biz.id}
                  className="showcase-phone-slot"
                  style={{
                    transform: `translate(-50%, -50%) translateX(${offset * 320}px) scale(${
                      isActive ? 1 : isSide ? 0.8 : 0.66
                    })`,
                    opacity: isActive ? 1 : isSide ? 0.55 : 0,
                    zIndex: isActive ? 30 : isSide ? 20 : 10,
                    pointerEvents: isActive || isSide ? "auto" : "none",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => goTo(index)}
                    aria-label={isActive ? `${biz.name}, currently shown` : `Show ${biz.name}`}
                    aria-current={isActive || undefined}
                    tabIndex={isActive || isSide ? 0 : -1}
                    aria-hidden={!isActive && !isSide}
                    className="showcase-phone-button"
                  >
                    <PhoneFrame label={`${biz.name} customer page example`}>
                      <CustomerVisitView
                        heroUrl={biz.heroSrc}
                        transform={DEFAULT_HERO_TRANSFORM}
                        heading={messages.ratingHeading}
                        support={messages.ratingSupport}
                        footerLine={messages.footerPromise}
                      >
                        <VisitStars value={null} messages={messages} preview />
                      </CustomerVisitView>
                    </PhoneFrame>
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              aria-label="Show next business"
              className="showcase-arrow showcase-arrow--right"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Mobile: one dominant phone, native horizontal swipe, peek of the next. */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="showcase-scroller mt-10 flex md:hidden"
          role="group"
          aria-roledescription="carousel"
          aria-label="Example ReviewBoost customer pages"
        >
          {SHOWCASE_BUSINESSES.map((biz, index) => (
            <div
              key={biz.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              className="showcase-scroller__item"
              aria-label={biz.name}
            >
              <PhoneFrame label={`${biz.name} customer page example`}>
                <CustomerVisitView
                  heroUrl={biz.heroSrc}
                  transform={DEFAULT_HERO_TRANSFORM}
                  heading={messages.ratingHeading}
                  support={messages.ratingSupport}
                  footerLine={messages.footerPromise}
                >
                  <VisitStars value={null} messages={messages} preview />
                </CustomerVisitView>
              </PhoneFrame>
            </div>
          ))}
        </div>

        {/* Shared controls: category picker + pagination dots. */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {SHOWCASE_BUSINESSES.map((biz, index) => (
            <button
              key={biz.id}
              type="button"
              onClick={() => goTo(index)}
              aria-pressed={index === activeIndex}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors duration-150",
                index === activeIndex
                  ? "border-ink bg-ink text-white"
                  : "border-border bg-white text-muted hover:border-brand hover:text-ink",
              )}
            >
              {biz.category}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2" aria-hidden="true">
          {SHOWCASE_BUSINESSES.map((biz, index) => (
            <span
              key={biz.id}
              className={cn(
                "size-1.5 rounded-full transition-colors duration-150",
                index === activeIndex ? "bg-brand" : "bg-quiet",
              )}
            />
          ))}
        </div>

        <p className="mt-6 text-center text-sm font-medium text-muted">
          Showing <span className="text-ink">{active.name}</span>
        </p>

        {/* Customization explainer — upload/preview/publish, nothing more. */}
        <div className="mt-16 rounded-3xl border border-border bg-white p-8 sm:p-10">
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              { step: "Upload", body: "Add a photo of your counter, your chair, your storefront." },
              { step: "Preview", body: "See exactly what customers will see before it goes live." },
              { step: "Publish", body: "One tap, and every scan of your Tag shows the new page." },
            ].map((item) => (
              <div key={item.step}>
                <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">{item.step}</p>
                <p className="mt-2 text-base leading-relaxed text-muted">{item.body}</p>
              </div>
            ))}
          </div>
          <h3 className="mt-10 text-xl font-bold tracking-[-0.01em] text-ink">
            Your business on top. ReviewBoost underneath.
          </h3>
          <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-muted">
            Upload your artwork, see exactly what customers will see, and publish. You are not building a website or
            choosing fonts, colors, or layouts — ReviewBoost keeps the rating and the Google handoff exactly as
            consistent as they are above.
          </p>
          <div className="mt-6 max-w-xs">
            <Button asChild variant="action" size="lg" className="rounded-full">
              <Link href="/examples">Explore Customer Page</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
