"use client";

import { heroTransformStyle, clampHeroTransform } from "@/lib/owner/hero-transform";
import type { CustomerReviewContext } from "@/lib/api/customer-flow-types";

interface CustomerHeroHeaderProps {
  context: CustomerReviewContext;
}

export function CustomerHeroHeader({ context }: CustomerHeroHeaderProps) {
  const { presentation } = context;
  if (!presentation.heroUrl) return null;

  const crop = clampHeroTransform(presentation.transform);

  return (
    <div className="customer-hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={presentation.heroUrl}
        alt=""
        draggable={false}
        className="customer-hero__img"
        style={{ transform: heroTransformStyle(crop) }}
      />
      <div className="customer-hero__scrim" />
      <div className="customer-hero__identity">
        <p className="customer-hero__name">{context.business.name}</p>
        {presentation.tagline ? (
          <p className="customer-hero__tagline">{presentation.tagline}</p>
        ) : null}
      </div>
    </div>
  );
}
