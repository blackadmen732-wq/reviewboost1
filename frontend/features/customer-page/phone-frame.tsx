"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The device the preview is drawn at: an iPhone's 390 × 844 point screen. */
const SCREEN_W = 390;
const SCREEN_H = 844;

/** The rendered hardware: a transparent front view with the screen cut out. */
export const HARDWARE_SRC = "/devices/phone-hardware.webp";

/**
 * The phone the owner previews their Customer Page in.
 *
 * Only the owner editor draws this. The live /q page never does: on a
 * customer's own phone, their phone is the frame. The screen inside is the
 * real CustomerVisitView at the 390/844 canvas — the frame only adds what a
 * phone adds on top of a page: the titanium and glass (a rendered picture of
 * the hardware), the Dynamic Island, the status bar and the home indicator.
 * All of it is decorative.
 *
 * The page is laid out at the real 390 × 844 and the finished picture is
 * scaled to the column, rather than laid out small. Laid out small, anything
 * sized in pixels — the logo, the minimum star size — came out proportionally
 * larger than on a phone, so the preview was an approximation. Scaled, it is
 * the page a customer on a 390pt iPhone sees, pixel for pixel.
 */
export function PhoneFrame({
  children,
  label = "Customer page",
  size = "default",
}: {
  children: ReactNode;
  label?: string;
  /**
   * `editor` draws the phone at a preview size that leaves room for the
   * photo action and Publish around it; the screen inside is still the real
   * 390 × 844 page, scaled.
   */
  size?: "default" | "editor";
}) {
  const screenRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.78);

  useLayoutEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const update = () => setScale(screen.clientWidth / SCREEN_W);
    update();
    // Without ResizeObserver the preview keeps the scale it was first given.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(screen);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={size === "editor" ? "phone-frame phone-frame--editor" : "phone-frame"} data-phone-frame>
      <div className="phone-frame__body">
        <div className="phone-frame__shape" aria-hidden="true" />
        <div className="phone-frame__glass" aria-hidden="true" />
        <div ref={screenRef} className="phone-frame__screen" role="img" aria-label={label}>
          <div
            className="phone-frame__device"
            style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})` }}
          >
            {children}
            <StatusBar />
            <div className="phone-frame__island" aria-hidden="true">
              <span className="phone-frame__lens" />
            </div>
            <div className="phone-frame__home" aria-hidden="true" />
          </div>
        </div>
        {/* A rendered picture of the hardware (titanium, glass, buttons), with
            the screen as an exact hole — see scripts/brand/render-phone-hardware.mjs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="phone-frame__hardware"
          src={HARDWARE_SRC}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
        />
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="phone-frame__status" aria-hidden="true">
      <span className="phone-frame__time">9:41</span>
      <span className="phone-frame__icons">
        {/* Cellular */}
        <svg viewBox="0 0 18 12" className="phone-frame__signal">
          <rect x="0" y="8" width="3" height="4" rx="0.8" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
          <rect x="10" y="3" width="3" height="9" rx="0.8" />
          <rect x="15" y="0" width="3" height="12" rx="0.8" />
        </svg>
        {/* Wi-Fi */}
        <svg viewBox="0 0 16 12" className="phone-frame__wifi">
          <path d="M8 11.6 5.6 9.2a3.4 3.4 0 0 1 4.8 0Z" />
          <path d="M3.4 7a6.5 6.5 0 0 1 9.2 0l-1.5 1.5a4.4 4.4 0 0 0-6.2 0Z" />
          <path d="M1.1 4.7a9.8 9.8 0 0 1 13.8 0l-1.5 1.5a7.7 7.7 0 0 0-10.8 0Z" />
        </svg>
        {/* Battery */}
        <svg viewBox="0 0 27 13" className="phone-frame__battery">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          <rect x="2" y="2" width="20" height="9" rx="2" />
          <path d="M25 4.5v4a2 2 0 0 0 0-4Z" fillOpacity="0.45" />
        </svg>
      </span>
    </div>
  );
}
