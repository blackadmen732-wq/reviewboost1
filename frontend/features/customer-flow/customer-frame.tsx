import type { ReactNode } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";

interface CustomerFrameProps {
  children: ReactNode;
}

/**
 * The frame for the customer page's loading and error states.
 *
 * Its footer uses the same canonical "Powered by ReviewBoost" lockup as the
 * loaded page (`customer-visit-view.tsx`), so a customer does not see the
 * credit change shape between loading, error and the page itself.
 */
export function CustomerFrame({ children }: CustomerFrameProps) {
  return (
    <main className="customer-page">
      <div className="customer-card">{children}</div>
      <footer className="powered-by">
        <ReviewBoostLogo pose="poweredBy" size="poweredBy" />
      </footer>
    </main>
  );
}
