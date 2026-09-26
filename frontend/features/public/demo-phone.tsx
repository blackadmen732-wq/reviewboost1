"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { VisitStars } from "@/features/customer-page/visit-stars";
import { customerMessages, type RatingValue } from "@/lib/i18n/customer-messages";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";

const messages = customerMessages.en;

/**
 * The real customer page, in a phone, for the marketing site.
 *
 * Same `CustomerVisitView` and `VisitStars` the live /q page and the owner
 * preview render, so a product shot on the website can never drift from what
 * a customer actually sees. Only the business artwork is sample data.
 *
 * The page is laid out at a real phone width (`baseWidth`) and then scaled as
 * one picture to whatever space it is given. Squeezing the layout itself
 * wrapped the heading and clipped the fifth star at small sizes — the thing a
 * product shot must never do.
 */
export function DemoPhone({
  heroSrc,
  label,
  value = null,
  baseWidth = 300,
}: {
  heroSrc: string;
  label: string;
  value?: RatingValue | null;
  baseWidth?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const outerNode = outer.current;
    const innerNode = inner.current;
    if (!outerNode || !innerNode || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const scale = outerNode.clientWidth / baseWidth;
      setBox({ scale, height: innerNode.offsetHeight * scale });
    });
    observer.observe(outerNode);
    observer.observe(innerNode);
    return () => observer.disconnect();
  }, [baseWidth]);

  return (
    <div ref={outer} className="w-full" style={box ? { height: box.height } : undefined}>
      <div
        ref={inner}
        style={{
          width: baseWidth,
          transform: box ? `scale(${box.scale})` : undefined,
          transformOrigin: "top left",
          // Until measured, render at a width that cannot overflow its slot.
          maxWidth: box ? undefined : "100%",
        }}
      >
        <PhoneFrame label={label} device>
          <CustomerVisitView
            heroUrl={heroSrc}
            transform={DEFAULT_HERO_TRANSFORM}
            heading={messages.ratingHeading}
            support={messages.ratingSupport}
            footerLine={messages.footerPromise}
          >
            <VisitStars value={value} messages={messages} preview />
          </CustomerVisitView>
        </PhoneFrame>
      </div>
    </div>
  );
}
