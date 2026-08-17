import type { ReactNode } from "react";

/**
 * The owner side of the product.
 *
 * Separate from the customer route group on purpose: the two audiences never
 * overlap. A customer sees one screen for thirty seconds and leaves; an owner
 * comes back daily and needs navigation, state, and their own data. Sharing a
 * layout between them would compromise both.
 */
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-canvas text-ink">{children}</div>;
}
