"use client";

import { useState } from "react";
import { Star } from "lucide-react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { PhoneFrame } from "@/features/customer-page/phone-frame";
import { VisitStars } from "@/features/customer-page/visit-stars";
import {
  customerMessages,
  type RatingValue,
} from "@/lib/i18n/customer-messages";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import { cn } from "@/lib/utils/cn";

// Placeholder names, not invented businesses: they show where the owner's
// own name appears on the page their customers see.
const EXAMPLES = [
  { id: "pizza", label: "Pizza shop", name: "Your Pizza Shop", photo: "/product/pizza-example.png" },
  { id: "barber", label: "Barber", name: "Your Barbershop", photo: "/product/barber-example.png" },
  { id: "salon", label: "Salon", name: "Your Salon", photo: "/product/salon-example.png" },
] as const;

/** Real customer presentation, clearly labelled as an example. No fake activity. */
export function ProductDemo({ hero = false }: { hero?: boolean }) {
  const [selected, setSelected] = useState(0);
  const [rating, setRating] = useState<RatingValue | null>(null);
  const example = EXAMPLES[selected]!;
  const messages = customerMessages.en;
  // Next's local image optimiser serves the existing artwork at preview size.
  const photo = `/_next/image?url=${encodeURIComponent(example.photo)}&w=640&q=75`;
  return (
    <figure
      className={cn("product-demo", hero && "product-demo--hero")}
      id="customer-example"
    >
      <div className="product-demo__objects" aria-hidden="true">
        <div className="product-demo__tag">
          <ReviewBoostLogo pose="full" size="poweredBy" />
          <p className="mt-5 text-lg font-semibold text-ink">
            How was your visit?
          </p>
          {/* A real sample QR, leading to the explanation, never a customer token. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/product/example-qr.svg"
            alt=""
            width={124}
            height={124}
            className="mx-auto my-5"
          />
          <p className="text-sm font-medium text-ink">Tap or scan</p>
          <p className="mt-1 text-xs text-muted">No app needed</p>
        </div>
        <PhoneFrame label={`${example.label} example customer page`}>
          <CustomerVisitView
            preview
            heroUrl={photo}
            transform={DEFAULT_HERO_TRANSFORM}
            businessName={example.name}
            heading={messages.ratingHeading}
            support={messages.ratingSupport}
            footerLine={messages.footerPromise}
          >
            <VisitStars value={rating} messages={messages} preview />
          </CustomerVisitView>
        </PhoneFrame>
      </div>
      <figcaption className="mt-6 text-center text-sm text-muted">
        Example customer page · {example.label}
      </figcaption>
      <div
        className="mt-2 flex flex-wrap justify-center gap-1"
        role="group"
        aria-label="Business examples"
      >
        {EXAMPLES.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected === index}
            onClick={() => {
              setSelected(index);
              setRating(null);
            }}
            className={cn(
              "min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
              selected === index
                ? "bg-quiet text-ink"
                : "text-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <fieldset className="mt-5 text-center">
        <legend className="mx-auto text-sm font-medium text-ink">
          Try a sample rating
        </legend>
        <div className="mt-2 flex justify-center gap-2">
          {([1, 2, 3, 4, 5] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rating === value}
              aria-label={`Try ${value} ${value === 1 ? "star" : "stars"}`}
              onClick={() => setRating(value)}
              className={cn(
                "min-h-11 min-w-11 rounded-[var(--radius-control)] border text-sm font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                rating === value
                  ? "border-action bg-action text-on-action"
                  : "border-border bg-surface text-ink hover:bg-quiet",
              )}
            >
              {hero ? (
                <Star
                  className="size-5"
                  aria-hidden="true"
                  fill={
                    rating !== null && value <= rating ? "currentColor" : "none"
                  }
                />
              ) : (
                value
              )}
            </button>
          ))}
        </div>
        <p
          className="mx-auto mt-3 max-w-[36ch] text-sm leading-relaxed text-muted"
          role="status"
        >
          {rating
            ? "On your live page, every rating is saved and continues to Google. This example saves nothing."
            : "See how the stars respond. No account needed; nothing is saved."}
        </p>
      </fieldset>
    </figure>
  );
}
