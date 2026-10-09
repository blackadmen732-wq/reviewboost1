"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { DevicePhone } from "@/features/public/device-phone";
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
    <section className="border-b border-border bg-surface" aria-labelledby="customer-page-showcase-heading">
      <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[40rem] text-center">
          <h2
            id="customer-page-showcase-heading"
            className="text-[clamp(2rem,4vw,3.25rem)] font-bold leading-[1.05] tracking-[-0.035em] text-ink"
          >
            Looks like your business. Works like ReviewBoost.
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-lg leading-relaxed text-muted">
            The top is yours. The rating underneath is the same for every business.
          </p>
        </div>

        {/* Desktop / tablet: three phones, transform-driven, no re-mount on change. */}
        <div
          className="showcase-track mt-14 hidden md:block"
          role="group"
          aria-roledescription="carousel"
          aria-label="Example ReviewBoost customer pages"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              goTo(activeIndex - 1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              goTo(activeIndex + 1);
            }
          }}
        >
          <p className="sr-only" aria-live="polite">
            Showing {SHOWCASE_BUSINESSES[activeIndex]?.name}
          </p>
          <div className="showcase-stage relative mx-auto flex h-[700px] max-w-[1100px] items-center justify-center">
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
                  data-position={isActive ? "center" : isSide ? "side" : "hidden"}
                  style={{
                    // Side phones tuck partly behind the centre one and turn
                    // a few degrees toward it: depth, not cover-flow.
                    transform: `translate(-50%, -50%) translateX(${offset * 230}px) translateY(${
                      isActive ? 0 : 18
                    }px) rotateY(${offset * -4}deg) scale(${isActive ? 1 : isSide ? 0.82 : 0.66})`,
                    opacity: isActive || isSide ? 1 : 0,
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
                    <DevicePhone label={`${biz.name} customer page example`}>
                      <CustomerVisitView
                        heroUrl={biz.heroSrc}
                        transform={DEFAULT_HERO_TRANSFORM}
                        heading={messages.ratingHeading}
                        support={messages.ratingSupport}
                        footerLine={messages.footerPromise}
                      >
                        <VisitStars value={null} messages={messages} preview />
                      </CustomerVisitView>
                    </DevicePhone>
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
              <DevicePhone label={`${biz.name} customer page example`}>
                <CustomerVisitView
                  heroUrl={biz.heroSrc}
                  transform={DEFAULT_HERO_TRANSFORM}
                  heading={messages.ratingHeading}
                  support={messages.ratingSupport}
                  footerLine={messages.footerPromise}
                >
                  <VisitStars value={null} messages={messages} preview />
                </CustomerVisitView>
              </DevicePhone>
            </div>
          ))}
        </div>

        {/* One control that both says which business is showing and moves to
            another. Dots, pills and a "Showing …" line all said the same
            thing three times. */}
        <div className="mt-8 flex justify-center">
          <div className="flex max-w-full flex-wrap justify-center gap-x-1">
            {SHOWCASE_BUSINESSES.map((biz, index) => (
              <button
                key={biz.id}
                type="button"
                onClick={() => goTo(index)}
                aria-pressed={index === activeIndex}
                aria-label={`Show ${biz.name} (${biz.category})`}
                className={cn(
                  "relative min-h-11 shrink-0 px-2.5 text-sm font-medium sm:px-3.5 transition-colors duration-150",
                  "after:absolute after:inset-x-2.5 after:bottom-1.5 sm:after:inset-x-3.5 after:h-0.5 after:rounded-full after:transition-colors after:duration-150",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] rounded-lg",
                  index === activeIndex
                    ? "text-ink after:bg-brand"
                    : "text-muted after:bg-transparent hover:text-ink",
                )}
              >
                {biz.category}
              </button>
            ))}
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-[48ch] text-center text-base leading-relaxed text-muted">
          Upload your artwork — a photo, a poster, your logo — preview exactly what customers
          see, and publish. The rating underneath is ReviewBoost&apos;s, and it never changes.{" "}
          <Link
            href="/examples"
            className="font-semibold text-brand-text underline-offset-4 hover:underline"
          >
            See more examples
          </Link>
        </p>
      </div>
    </section>
  );
}
