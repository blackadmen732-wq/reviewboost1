"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { HandoffScreen } from "@/features/customer-flow/screens/handoff-screen";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { DevicePhone } from "@/features/public/device-phone";
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
  screen = "rating",
  businessName = "Mario's Pizza",
}: {
  heroSrc: string;
  label: string;
  value?: RatingValue | null;
  baseWidth?: number;
  /** "handoff" shows the real screen every rating reaches on its way to Google. */
  screen?: "rating" | "handoff";
  businessName?: string;
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
    <div ref={outer} className="w-full" style={box ? { height: box.height } : undefined} inert>
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
        <DevicePhone label={label}>
          <CustomerVisitView
            heroUrl={heroSrc}
            transform={DEFAULT_HERO_TRANSFORM}
            heading={screen === "rating" ? messages.ratingHeading : ""}
            support={screen === "rating" ? messages.ratingSupport : ""}
            footerLine={messages.footerPromise}
          >
            {screen === "rating" ? (
              <VisitStars value={value} messages={messages} preview />
            ) : (
              <HandoffScreen
                businessName={businessName}
                destinationUrl="#"
                messages={messages}
              />
            )}
          </CustomerVisitView>
        </DevicePhone>
      </div>
    </div>
  );
}
