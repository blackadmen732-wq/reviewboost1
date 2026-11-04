import type { ReactNode } from "react";

import { Providers } from "@/components/providers";
import "@/styles/customer-flow.css";

/** The customer flow is the one place that reads and writes through React Query. */
export default function CustomerLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
