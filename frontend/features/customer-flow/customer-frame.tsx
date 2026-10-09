import type { ReactNode } from "react";
import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";

interface CustomerFrameProps {
  children: ReactNode;
  poweredBy: string;
}

export function CustomerFrame({ children, poweredBy }: CustomerFrameProps) {
  return (
    <main className="customer-page">
      <div className="customer-card">{children}</div>
      <footer className="powered-by">
        {/* The same lockup as the owner product and the public site, mark
            included — not a second, text-only wordmark. */}
        <ReviewBoostLogo
          pose="poweredBy"
          size="poweredBy"
          poweredByLabel={poweredBy.replace(/ReviewBoost$/u, "").trim()}
        />
      </footer>
    </main>
  );
}
