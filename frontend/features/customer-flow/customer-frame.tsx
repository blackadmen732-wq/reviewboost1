import type { ReactNode } from "react";
import { ReviewBoostWordmark } from "@/components/brand/reviewboost-wordmark";

interface CustomerFrameProps {
  children: ReactNode;
  poweredBy: string;
  hasHero?: boolean;
}

export function CustomerFrame({ children, poweredBy, hasHero }: CustomerFrameProps) {
  return (
    <main className="customer-page" data-has-hero={hasHero || undefined}>
      <div className="customer-card">{children}</div>
      <footer className="powered-by">
        <ReviewBoostWordmark
          prefix={poweredBy.replace(/ReviewBoost$/u, "").trim()}
        />
      </footer>
    </main>
  );
}
