"use client";

import { CUSTOMER_CANVAS } from "@/lib/owner/customer-canvas";
import { clampHeroTransform, heroTransformStyle, type HeroTransform } from "@/lib/owner/hero-transform";
import { ReviewBoostWordmark } from "@/components/brand/reviewboost-wordmark";

interface CustomerPageViewProps {
  businessName: string;
  heroUrl: string | null;
  transform: HeroTransform;
  tagline: string | null;
  ratingHeading?: string;
  ratingSubtext?: string;
  onPointerDown?: React.PointerEventHandler | undefined;
  onPointerMove?: React.PointerEventHandler | undefined;
  onPointerUp?: React.PointerEventHandler | undefined;
  onWheel?: React.WheelEventHandler | undefined;
}

export function CustomerPageView({
  businessName,
  heroUrl,
  transform,
  tagline,
  ratingHeading = "How was your visit?",
  ratingSubtext = "Tap a star to let us know",
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
}: CustomerPageViewProps) {
  const crop = clampHeroTransform(transform);
  const hasGestures = Boolean(onPointerDown);

  return (
    <div
      className="overflow-hidden rounded-[28px] border-[6px] border-[color:var(--rb-ink)] bg-[#100c09] shadow-lg"
      style={{ aspectRatio: CUSTOMER_CANVAS.aspectRatio }}
    >
      {/* Hero section */}
      <div
        className="relative overflow-hidden"
        style={{
          height: `${CUSTOMER_CANVAS.heroShare * 100}%`,
          background: heroUrl
            ? undefined
            : "linear-gradient(166deg, #3b3128 0%, #251d17 48%, #16110d 100%)",
          cursor: hasGestures && heroUrl ? "grab" : undefined,
          touchAction: hasGestures && heroUrl ? "none" : undefined,
        }}
        onPointerDown={heroUrl ? onPointerDown : undefined}
        onPointerMove={heroUrl ? onPointerMove : undefined}
        onPointerUp={heroUrl ? onPointerUp : undefined}
        onPointerCancel={heroUrl ? onPointerUp : undefined}
        onWheel={heroUrl ? onWheel : undefined}
      >
        {heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroUrl}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            style={{ transform: heroTransformStyle(crop) }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/40">
            No photo yet
          </div>
        )}
        {heroUrl ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, rgb(14 10 8 / 62%) 0%, rgb(14 10 8 / 40%) 24%, rgb(14 10 8 / 14%) 44%, rgb(14 10 8 / 0%) 62%)",
            }}
          />
        ) : null}
        <div className="pointer-events-none relative mt-auto px-4 pb-3 pt-8 text-center text-white drop-shadow-lg">
          <p className="text-lg font-bold leading-tight">{businessName}</p>
          {tagline ? (
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80">
              {tagline}
            </p>
          ) : null}
        </div>
      </div>

      {/* Rating card */}
      <div
        className="flex flex-col items-center rounded-t-[20px] bg-white px-4 pb-4 pt-5 text-center"
        style={{
          height: `${CUSTOMER_CANVAS.cardShare * 100}%`,
          marginTop: "-20px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <h2 className="text-lg font-extrabold leading-tight tracking-tight text-[#1a1712]">
          {ratingHeading}
        </h2>
        <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6b635b]">
          {ratingSubtext}
        </p>
        <div className="mt-4 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <svg
              key={n}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8f8579"
              strokeWidth={1.25}
              className="h-8 w-8"
              aria-hidden="true"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          ))}
        </div>
        <div className="mt-auto">
          <ReviewBoostWordmark prefix="Powered by" className="text-[#6b635b]" />
        </div>
      </div>
    </div>
  );
}
