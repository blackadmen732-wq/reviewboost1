"use client";

import localFont from "next/font/local";
import { useEffect, useRef, useState, type ReactNode } from "react";

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

/**
 * The heading and "Powered by" face of the approved reference. Measured
 * against it pixel for pixel, Inter Tight overlaps the reference heading at 0.80
 * (Geist, the app face, peaks at 0.34 — it cannot reach the reference's
 * height at the reference's width). Bundled, latin subset, SIL OFL 1.1 — see
 * lib/fonts/InterTight-OFL.txt.
 */
const visitHeadingFont = localFont({
  src: "../../lib/fonts/InterTight-latin-variable.woff2",
  variable: "--font-visit-heading",
  weight: "100 900",
  display: "swap",
});

/**
 * The face of the reference's two tracked-caps lines, the instruction and the
 * promise line. DM Sans overlaps them at 0.55 and 0.71 where Geist reaches
 * 0.25 and 0.29 — its round O, C and G are what those lines are made of.
 * Bundled, latin subset, SIL OFL 1.1 — see lib/fonts/DMSans-OFL.txt.
 */
const visitCapsFont = localFont({
  src: "../../lib/fonts/DMSans-latin-variable.woff2",
  variable: "--font-visit-caps",
  weight: "100 1000",
  display: "swap",
});

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
      className={`visit-stage ${visitHeadingFont.variable} ${visitCapsFont.variable}`}
      data-customer-visit
      data-customer-canvas={CUSTOMER_CANVAS.aspectRatio}
      data-card-fixed=""
    >
      <div className="visit-hero" data-hero-layer>
        {heroUrl ? (
          <HeroImage src={heroUrl} transform={heroTransformStyle(crop)} />
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
          {/* The approved reference: a small grey bolt, grey "Powered by",
              and "ReviewBoost" in ink. */}
          <p className="visit-powered">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M13.14 1 4.9 13.76h5.97L10.02 23 19.1 9.36h-6.06L13.14 1Z" />
            </svg>
            <span>
              Powered by <strong>ReviewBoost</strong>
            </span>
          </p>
          <p className="visit-footer__line">{footerLine}</p>
        </footer>
      </section>
    </div>
  );
}

/**
 * The business's artwork. The hero keeps its size on the dark field while the
 * photo downloads, then the photo fades in — no layout jump, no white flash.
 * A photo already in the cache (or one that loaded before hydration) is shown
 * at once rather than waiting for an onLoad that already fired.
 */
function HeroImage({ src, transform }: { src: string; transform: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(Boolean(ref.current?.complete && ref.current.naturalWidth > 0));
  }, [src]);

  return (
    // Artwork origin is the owner's published/draft upload.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      className="visit-hero__image"
      data-loaded={loaded || undefined}
      onLoad={() => setLoaded(true)}
      style={{ transform }}
    />
  );
}
