"use client";

import type { ReactNode } from "react";

/**
 * Phone chrome around the live customer view (SoT v1.9).
 * The screen inside is the customer page — same 390/844 canvas as /q.
 *
 * `device` draws the full physical phone used on the marketing site: a
 * graphite titanium edge, side buttons, the Dynamic Island, a status bar and
 * the home indicator — the Mario's Pizza reference's phone. Everything is
 * sized in container units, so it is the same object at 200px or 420px.
 * The owner preview keeps the plain frame by default.
 */

function StatusBar() {
  return (
    <div className="phone-frame__status" aria-hidden="true">
      <span className="phone-frame__time">9:41</span>
      <span className="phone-frame__glyphs">
        <svg viewBox="0 0 18 12" className="phone-frame__glyph">
          <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" />
          <rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" />
          <rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 16 12" className="phone-frame__glyph">
          <path
            d="M8 11.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM3.6 6.9a6.3 6.3 0 0 1 8.8 0l-1.3 1.3a4.4 4.4 0 0 0-6.2 0Zm-2.6-2.6a10 10 0 0 1 14 0l-1.3 1.3a8.1 8.1 0 0 0-11.4 0Z"
            fill="currentColor"
          />
        </svg>
        <svg viewBox="0 0 27 12" className="phone-frame__glyph phone-frame__glyph--battery">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2" width="19" height="8" rx="2" fill="currentColor" />
          <path d="M24.5 4v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity="0.45" />
        </svg>
      </span>
    </div>
  );
}

export function PhoneFrame({
  children,
  label = "Customer page",
  device = false,
  statusTone = "light",
}: {
  children: ReactNode;
  label?: string;
  device?: boolean;
  /** Status bar ink: light over artwork, dark over a light screen. */
  statusTone?: "light" | "dark";
}) {
  if (!device) {
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

  return (
    <div className="phone-frame phone-frame--device" data-phone-frame data-status={statusTone}>
      <span className="phone-frame__button phone-frame__button--action" aria-hidden="true" />
      <span className="phone-frame__button phone-frame__button--up" aria-hidden="true" />
      <span className="phone-frame__button phone-frame__button--down" aria-hidden="true" />
      <span className="phone-frame__button phone-frame__button--power" aria-hidden="true" />
      <div className="phone-frame__bezel">
        <div className="phone-frame__glass">
          <div className="phone-frame__screen" role="img" aria-label={label}>
            {children}
            <StatusBar />
            <div className="phone-frame__island" aria-hidden="true" />
            <div className="phone-frame__home" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
