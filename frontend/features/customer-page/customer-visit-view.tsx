"use client";

import type { PointerEvent, ReactNode, WheelEvent } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import {
  clampHeroTransform,
  heroTransformStyle,
  type HeroTransform,
} from "@/lib/owner/hero-transform";
import { cn } from "@/lib/utils/cn";

/**
 * The customer page. Owner preview and live /q render this same tree.
 * Positioning in the phone frame is this view — not a mock, not a later check.
 *
 * Mario SoT: rich hero, fixed white “How was your visit?” card, five stars,
 * ReviewBoost footer. No location. No org/tag ids.
 */

export interface CustomerVisitViewProps {
  heroUrl: string | null;
  transform: HeroTransform;
  tagline?: string | null;
  heading: string;
  support: string;
  poweredBy?: string;
  children: ReactNode;
  language?: ReactNode;
  /** Owner editor only: drag/pinch the hero. The card never receives this. */
  heroInteractive?: boolean;
  onHeroPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onHeroPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
  onHeroPointerUp?: (event: PointerEvent<HTMLDivElement>) => void;
  onHeroWheel?: (event: WheelEvent<HTMLDivElement>) => void;
}

export function CustomerVisitView({
  heroUrl,
  transform,
  tagline,
  heading,
  support,
  children,
  language,
  heroInteractive = false,
  onHeroPointerDown,
  onHeroPointerMove,
  onHeroPointerUp,
  onHeroWheel,
}: CustomerVisitViewProps) {
  const crop = clampHeroTransform(transform);

  return (
    <div className="visit-stage" data-customer-visit>
      <div
        className={cn("visit-hero", heroInteractive && "visit-hero--live")}
        data-hero-layer
        onPointerDown={heroInteractive ? onHeroPointerDown : undefined}
        onPointerMove={heroInteractive ? onHeroPointerMove : undefined}
        onPointerUp={heroInteractive ? onHeroPointerUp : undefined}
        onPointerCancel={heroInteractive ? onHeroPointerUp : undefined}
        onWheel={heroInteractive ? onHeroWheel : undefined}
      >
        {heroUrl ? (
          // Artwork origin is the owner's published/draft upload.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroUrl}
            alt=""
            draggable={false}
            className="visit-hero__image"
            style={{ transform: heroTransformStyle(crop) }}
          />
        ) : (
          <div className="visit-hero__empty" aria-hidden="true" />
        )}
        {tagline ? <p className="visit-tagline">{tagline}</p> : null}
        {language ? <div className="visit-language">{language}</div> : null}
      </div>

      <section className="visit-card" data-rating-card>
        {heading ? (
          <div className="visit-card__copy">
            <h1 className="visit-heading" data-screen-heading tabIndex={-1}>
              {heading}
            </h1>
            {support ? <p className="visit-support">{support}</p> : null}
          </div>
        ) : null}
        <div className="visit-card__body">{children}</div>
        <footer className="visit-footer">
          <ReviewBoostLogo pose="poweredBy" size="poweredBy" />
        </footer>
      </section>
    </div>
  );
}
