"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * A number that counts up to itself as it arrives.
 *
 * The final value is what the server renders, and what a screen reader, a
 * test or a browser without JavaScript reads; the count is drawn over it only
 * where motion is welcome. It writes the text directly, frame by frame, rather
 * than re-rendering React sixty times a second, and the span is keyed on the
 * value so a new number always starts from a clean node.
 *
 * On a first page load the number is already on screen by the time React
 * hydrates, and counting from zero then would snatch the real value away. So
 * it counts when it mounts fresh — a screen opened inside the app — or when
 * hydration came while the page was still easing in.
 */

let pageHydrated = false;

/** How late into a first load a count may still start (ms since navigation). */
const HYDRATION_GRACE = 700;

export function CountUp({
  value,
  decimals = 0,
  duration = 1000,
  delay = 0,
  className,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = value.toFixed(decimals);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const sinceLoad = Number(document.timeline?.currentTime ?? Number.POSITIVE_INFINITY);
    const fresh = pageHydrated || sinceLoad < HYDRATION_GRACE;
    const motionWelcome = window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches === true;
    if (!fresh || !motionWelcome) return;

    const start = performance.now() + delay;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      // Ease out: quick at first, settling gently onto the real value.
      const eased = 1 - (1 - progress) ** 4;
      element.textContent = (value * eased).toFixed(decimals);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };

    element.textContent = (0).toFixed(decimals);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      element.textContent = text;
    };
  }, [value, decimals, duration, delay, text]);

  useEffect(() => {
    pageHydrated = true;
  }, []);

  return (
    <span key={text} ref={ref} className={className}>
      {text}
    </span>
  );
}
