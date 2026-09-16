"use client";

import type { ReactNode } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { CUSTOMER_CANVAS } from "@/lib/owner/customer-canvas";
import {
  clampHeroTransform,
  heroTransformStyle,
  type HeroTransform,
} from "@/lib/owner/hero-transform";

/**
 * The customer page. Owner preview and live /q render this same tree.
 * Positioning in the phone frame is this view — not a mock, not a later check.
 *
 * SoT v1.9 / v1.10: Mario’s Pizza — rich hero, fixed white card, five stars,
 * ReviewBoost footer. No location. Same crop the customer sees.
 *
 * The hero has no drag or pinch controls in V1. It carried a single-pointer
 * drag and a wheel handler that read as pinch-to-zoom without being it, and the
 * Customer Page contract stores no per-owner transform — so whatever the owner
 * dragged to was never sent anywhere and the customer received the default crop
 * regardless. One deterministic crop, shared by this preview and /q/{token}, is
 * the honest version. Real crop controls need the transform persisted first.
 */

export interface CustomerVisitViewProps {
  heroUrl: string | null;
  transform: HeroTransform;
  heading: string;
  support: string;
  footerLine: string;
  children: ReactNode;
  language?: ReactNode;
}

export function CustomerVisitView({
  heroUrl,
  transform,
  heading,
  support,
  footerLine,
  children,
  language,
}: CustomerVisitViewProps) {
  const crop = clampHeroTransform(transform);

  return (
    <div
      className="visit-stage"
      data-customer-visit
      data-customer-canvas={CUSTOMER_CANVAS.aspectRatio}
      data-card-fixed=""
    >
      <div className="visit-hero" data-hero-layer>
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
          <p className="visit-footer__line">{footerLine}</p>
        </footer>
      </section>
    </div>
  );
}
