import type { ReactNode } from "react";
export function CustomerActionBar({ children }: { children: ReactNode }) {
  return <div className="customer-action-bar">{children}</div>;
}
