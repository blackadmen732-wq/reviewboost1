import { Star, Zap } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { customerMessages } from "@/lib/i18n/customer-messages";

/**
 * The first frame, before anything is known.
 *
 * Not a shimmer over five grey boxes. The composition is the same composition,
 * and the question is already the real question — it is the same question at
 * every business, so there is nothing to wait for. Only the hero and the stars
 * are unresolved, which means the page does not visibly rearrange itself when
 * the business arrives.
 *
 * A server component with no interactivity: the stars are inert glyphs here,
 * because a control that accepts a tap it cannot record is worse than one that
 * plainly is not ready yet.
 */
export function CustomerPageSkeleton() {
  const messages = customerMessages.en;

  return (
    <main className="cp" data-mode="live">
      <div className="cp__frame">
        <div className="cp-hero" data-media="neutral" data-look="minimal" aria-hidden="true">
          <span className="cp-hero__scrim" />
        </div>

        <section className="cp-sheet" data-status="loading" aria-busy="true">
          <h1 className="cp-sheet__question">{messages.question}</h1>
          <p className="cp-sheet__instruction">{messages.tapInstruction}</p>

          <div className="cp-stars" aria-hidden="true">
            <div className="cp-stars__row">
              {[1, 2, 3, 4, 5].map((star) => (
                <span className="cp-star" key={star}>
                  <span className="cp-star__label">
                    <Star className="cp-star__glyph" strokeWidth={1.5} />
                  </span>
                </span>
              ))}
            </div>
          </div>

          <footer className="cp-sheet__footer">
            <p className="cp-sheet__powered">
              <Zap className="cp-sheet__bolt" aria-hidden="true" strokeWidth={2.5} />
              <span>{messages.poweredByPrefix}</span>
              <Wordmark size="sm" tone="mono" className="cp-sheet__mark" />
            </p>
            <p className="cp-sheet__brandline">{messages.brandLine}</p>
          </footer>
        </section>
      </div>
    </main>
  );
}
