"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Lays its content out at least `minWidth` wide and scales it down as one
 * picture when the space is narrower. For product screenshots built from real
 * components: on a phone they shrink like an image instead of re-flowing into
 * a cramped layout the real app would never show at that size.
 */
export function ScaleToFit({ minWidth, children }: { minWidth: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const outerNode = outer.current;
    const innerNode = inner.current;
    if (!outerNode || !innerNode || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const available = outerNode.clientWidth;
      const width = Math.max(minWidth, available);
      const scale = available / width;
      setBox({ scale, width, height: innerNode.offsetHeight * scale });
    });
    observer.observe(outerNode);
    observer.observe(innerNode);
    return () => observer.disconnect();
  }, [minWidth]);

  return (
    <div ref={outer} className="w-full" style={box ? { height: box.height } : undefined}>
      <div
        ref={inner}
        style={
          box
            ? { width: box.width, transform: `scale(${box.scale})`, transformOrigin: "top left" }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
