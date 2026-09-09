"use client";

import type { ReactNode } from "react";

/**
 * Phone chrome around the live customer view.
 * The screen inside is the customer page — not a sketch of it.
 */

export function PhoneFrame({
  children,
  label = "Customer page",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="phone-frame" data-phone-frame>
      <div className="phone-frame__bezel">
        <div className="phone-frame__island" aria-hidden="true" />
        <div className="phone-frame__screen" role="img" aria-label={label}>
          {children}
        </div>
      </div>
    </div>
  );
}
