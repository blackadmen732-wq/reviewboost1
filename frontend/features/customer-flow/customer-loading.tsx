"use client";

import { useEffect, useState } from "react";

import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { STAR_PATH } from "@/features/customer-page/visit-stars";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

/**
 * The page while the business's details load: the same sheet the customer is
 * about to see, in the same place, with soft placeholders for the question and
 * the five stars. It used to be a different page altogether — a header, boxed
 * stars, another footer — that every customer saw for a moment before the real
 * one jumped in over it.
 *
 * The top is plain white until the business's own image is known.
 */
export function CustomerLoading({ messages }: { messages: CustomerMessages }) {
  const [showOpeningMessage, setShowOpeningMessage] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setShowOpeningMessage(true), 1000);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className="customer-live">
      <CustomerVisitView
        heroUrl={null}
        transform={DEFAULT_HERO_TRANSFORM}
        heading=""
        support=""
        footerLine={messages.footerPromise}
        placeholder
      >
        <section className="flow-screen loading-screen" aria-busy="true">
          <div className="visit-stars__row loading-stars" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((index) => (
              <span
                key={index}
                className="visit-star visit-star--placeholder"
                style={{ "--star-index": index } as React.CSSProperties}
              >
                <span className="visit-star__label">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d={STAR_PATH} strokeWidth={0.62} strokeLinejoin="round" />
                  </svg>
                </span>
              </span>
            ))}
          </div>
          <div className="rating-actions">
            <p className="visit-status opening-message" role="status" aria-live="polite">
              {showOpeningMessage ? messages.opening : ""}
            </p>
          </div>
        </section>
      </CustomerVisitView>
    </div>
  );
}
