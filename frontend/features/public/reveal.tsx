"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The one motion idea on the marketing site: a section rises and fades in as
 * it enters the viewport, once, then stays put. Nothing loops, nothing
 * competes for attention — the signature moment lives in the Tag/phone tap,
 * not here.
 *
 * `prefers-reduced-motion` is handled in CSS (`.rb-reveal`), so this component
 * only has to decide *when* to flip `data-visible`, never whether motion is
 * allowed.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Environments without IntersectionObserver (older browsers, jsdom in
    // tests) get the content immediately rather than permanently invisible.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -40px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-visible={visible ? "true" : "false"}
      className={`rb-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
