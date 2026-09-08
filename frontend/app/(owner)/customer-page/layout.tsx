import type { ReactNode } from "react";

/*
 * The customer page's stylesheet, on the owner's screen.
 *
 * Loaded here rather than globally because it is only needed where a customer
 * page is being previewed. Every rule in it is scoped under `.cp`, so it styles
 * the preview and touches nothing else on the dashboard.
 */
import "@/styles/customer-page.css";
import "@/styles/customer-page-designer.css";

export default function CustomerPageDesignerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
