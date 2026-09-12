"use client";

import { useCallback, useRef, type PointerEvent, type WheelEvent } from "react";

import { clampHeroTransform, type HeroTransform } from "@/lib/owner/hero-transform";

/**
 * Drag + pinch/zoom on the hero only. The rating card is not in this handler.
 * Transform updates are immediate — the same view the customer will see.
 */

export function useHeroGestures(
  transform: HeroTransform,
  onChange: (next: HeroTransform) => void,
) {
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    origin: HeroTransform;
  } | null>(null);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        origin: transform,
      };
    },
    [transform],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const dx = ((event.clientX - drag.current.x) / box.width) * 100;
      const dy = ((event.clientY - drag.current.y) / box.height) * 100;
      onChange(
        clampHeroTransform({
          x: drag.current.origin.x + dx,
          y: drag.current.origin.y + dy,
          scale: drag.current.origin.scale,
        }),
      );
    },
    [onChange],
  );

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const next = transform.scale + (event.deltaY < 0 ? 0.08 : -0.08);
      onChange(clampHeroTransform({ ...transform, scale: next }));
    },
    [onChange, transform],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onWheel };
}
