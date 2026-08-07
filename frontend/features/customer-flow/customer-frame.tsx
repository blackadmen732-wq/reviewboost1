import type { ReactNode } from "react";
import { ReviewBoostWordmark } from "@/components/brand/reviewboost-wordmark";

interface CustomerFrameProps {
  children: ReactNode;
  poweredBy: string;
}

export function CustomerFrame({ children, poweredBy }: CustomerFrameProps) {
  return (
    <main className="customer-page">
      <div className="customer-card">{children}</div>
      <footer className="powered-by">
        <ReviewBoostWordmark
          prefix={poweredBy.replace(/ReviewBoost$/u, "").trim()}
        />
      </footer>
    </main>
  );
}
