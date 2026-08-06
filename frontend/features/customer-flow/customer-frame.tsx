import type { ReactNode } from "react";

interface CustomerFrameProps {
  children: ReactNode;
  poweredBy: string;
}

export function CustomerFrame({ children, poweredBy }: CustomerFrameProps) {
  return (
    <main className="customer-page">
      <div className="customer-card">{children}</div>
      <footer className="powered-by">{poweredBy}</footer>
    </main>
  );
}

