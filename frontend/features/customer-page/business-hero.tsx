"use client";

import { useState, type ReactNode } from "react";

import { BusinessWordmark } from "@/features/customer-page/business-wordmark";
import type { CustomerPageDesign } from "@/lib/customer-page/design";

interface BusinessHeroProps {
  businessName: string;
  design: CustomerPageDesign;
  logoAlt: string;
  /** The language control, and nothing else. The hero has no other chrome. */
  children?: ReactNode;
}

/**
 * The top two thirds of the customer page, which belong to the business.
 *
 * Full bleed, no card, no border, no rounded corners at the top: the photograph
 * is the page, the way the picture is the page on a good menu. The owner's focal
 * point and crop decide what stays in frame, so a photograph shot for Instagram
 * can still put its subject low and leave the upper middle dark enough to carry
 * a name.
 *
 * The photograph is decoration. Its `alt` is empty because the identity beneath
 * it is real text, and it is deliberately not awaited by anything: if it fails,
 * is slow, or was never uploaded, the hero renders as a warm dark panel with the
 * business's name on it and the stars below are already usable. A page that
 * cannot show a photo still collects the rating.
 */
export function BusinessHero({
  businessName,
  design,
  logoAlt,
  children,
}: BusinessHeroProps) {
  const [brokenSources, setBrokenSources] = useState<readonly string[]>([]);

  function markBroken(source: string) {
    setBrokenSources((current) =>
      current.includes(source) ? current : [...current, source],
    );
  }

  const photo =
    design.heroImage && !brokenSources.includes(design.heroImage)
      ? design.heroImage
      : null;
  const logo =
    design.logo && !brokenSources.includes(design.logo) ? design.logo : null;

  return (
    <div className="cp-hero" data-look={design.look} data-media={photo ? "photo" : "neutral"}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="cp-hero__photo"
          src={photo}
          alt=""
          decoding="async"
          fetchPriority="high"
          onError={() => markBroken(photo)}
          style={{
            objectPosition: `${design.heroFocalX}% ${design.heroFocalY}%`,
            transformOrigin: `${design.heroFocalX}% ${design.heroFocalY}%`,
            transform: design.heroZoom > 1 ? `scale(${design.heroZoom})` : undefined,
          }}
        />
      ) : null}
      <span className="cp-hero__scrim" aria-hidden="true" />

      <div className="cp-hero__top">{children}</div>

      {/* Nothing to compose until the business is known, and an empty wordmark
          flashing into place is worse than a calm dark panel. */}
      <div className="cp-hero__identity" hidden={!logo && !businessName.trim()}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="cp-hero__logo"
            src={logo}
            alt={logoAlt}
            decoding="async"
            onError={() => markBroken(logo)}
          />
        ) : (
          <BusinessWordmark businessName={businessName} look={design.look} />
        )}
        {design.tagline ? <p className="cp-hero__tagline">{design.tagline}</p> : null}
      </div>
    </div>
  );
}
