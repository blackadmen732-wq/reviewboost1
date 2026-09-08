"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Move, ZoomIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BusinessHero } from "@/features/customer-page/business-hero";
import { heroAspectRatio } from "@/features/customer-page-designer/hero-frame";
import {
  maxHeroZoom,
  minHeroZoom,
  type CustomerPageDesign,
} from "@/lib/customer-page/design";

interface PhotoFocalEditorProps {
  design: CustomerPageDesign;
  businessName: string;
  logoAlt: string;
  onChange: (design: CustomerPageDesign) => void;
  onDone: () => void;
  onCancel: () => void;
}

interface Pointer {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Drag the photograph, zoom it, done.
 *
 * The frame is the real hero ratio with the real wordmark over it, because the
 * decision the owner is making is "does the subject sit where the name isn't" —
 * which is unanswerable against a bare rectangle.
 *
 * Dragging is in pixels and the design is in percentages, and the conversion is
 * not a guess. The photograph is drawn `cover`, so it is already scaled by
 * `max(boxW / imageW, boxH / imageH)` before the owner's zoom applies; the part
 * hanging outside the frame after both is the entire distance the focal point
 * can travel. Dividing the drag by that distance is what makes the photograph
 * track the finger at every zoom level instead of drifting or fighting it.
 */
export function PhotoFocalEditor({
  design,
  businessName,
  logoAlt,
  onChange,
  onDone,
  onCancel,
}: PhotoFocalEditorProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const naturalSize = useRef<{ width: number; height: number } | null>(null);
  const pointers = useRef(new Map<number, Pointer>());
  const pinchDistance = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const [start] = useState(() => design);

  // The drag conversion needs the photograph's real proportions. Reading them
  // from a second decode rather than from the hero's own <img> keeps the
  // customer component free of props that exist only for this editor; the
  // source is already in memory, so nothing is fetched twice.
  const source = design.heroImage;
  useEffect(() => {
    if (!source) return;
    let current = true;
    const image = new Image();
    image.src = source;
    void image
      .decode()
      .then(() => {
        if (current) {
          naturalSize.current = {
            width: image.naturalWidth,
            height: image.naturalHeight,
          };
        }
      })
      .catch(() => {
        naturalSize.current = null;
      });
    return () => {
      current = false;
    };
  }, [source]);

  const travel = useCallback(
    (zoom: number) => {
      const frame = frameRef.current;
      const natural = naturalSize.current;
      if (!frame || !natural) return null;

      const box = frame.getBoundingClientRect();
      const cover = Math.max(box.width / natural.width, box.height / natural.height);
      return {
        x: Math.max(0, natural.width * cover * zoom - box.width),
        y: Math.max(0, natural.height * cover * zoom - box.height),
      };
    },
    [],
  );

  const pan = useCallback(
    (dx: number, dy: number) => {
      const range = travel(design.heroZoom);
      if (!range) return;

      // An axis with nothing hanging outside the frame has nothing to pan.
      const stepX = range.x > 0.5 ? (dx / range.x) * 100 : 0;
      const stepY = range.y > 0.5 ? (dy / range.y) * 100 : 0;
      if (stepX === 0 && stepY === 0) return;

      onChange({
        ...design,
        heroFocalX: Math.round(clamp(design.heroFocalX - stepX, 0, 100)),
        heroFocalY: Math.round(clamp(design.heroFocalY - stepY, 0, 100)),
      });
    },
    [design, onChange, travel],
  );

  const setZoom = useCallback(
    (zoom: number) => {
      onChange({
        ...design,
        heroZoom: Math.round(clamp(zoom, minHeroZoom, maxHeroZoom) * 100) / 100,
      });
    },
    [design, onChange],
  );

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      const [a, b] = points as [Pointer, Pointer];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance.current !== null && pinchDistance.current > 0) {
        setZoom(design.heroZoom * (distance / pinchDistance.current));
      }
      pinchDistance.current = distance;
      return;
    }

    pan(event.clientX - previous.x, event.clientY - previous.y);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = null;
    if (pointers.current.size === 0) setDragging(false);
  }

  function nudge(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (!move) return;

    event.preventDefault();
    // Keyboard steps are in focal percent directly: a pixel-based nudge would
    // move a different amount at every zoom level.
    onChange({
      ...design,
      heroFocalX: Math.round(clamp(design.heroFocalX - move[0], 0, 100)),
      heroFocalY: Math.round(clamp(design.heroFocalY - move[1], 0, 100)),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        ref={frameRef}
        className="relative mx-auto w-full max-w-[320px] overflow-hidden rounded-[20px] bg-[#100c09] shadow-[var(--shadow-control)]"
        style={{ aspectRatio: heroAspectRatio }}
      >
        <BusinessHero businessName={businessName} design={design} logoAlt={logoAlt} />

        <div
          role="application"
          aria-label="Drag to reposition the photo. Arrow keys nudge it."
          tabIndex={0}
          className={[
            "absolute inset-0 touch-none rounded-[20px]",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
            dragging ? "cursor-grabbing" : "cursor-grab",
          ].join(" ")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={nudge}
        />

        <p className="pointer-events-none absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-white/85 [text-shadow:0_1px_3px_rgb(0_0_0/60%)]">
          <Move className="size-3.5" aria-hidden="true" />
          Drag to reposition
        </p>
      </div>

      <label className="flex items-center gap-3">
        <ZoomIn className="size-5 shrink-0 text-muted" aria-hidden="true" />
        <span className="sr-only">Zoom</span>
        <input
          type="range"
          min={minHeroZoom}
          max={maxHeroZoom}
          step={0.05}
          value={design.heroZoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="h-11 w-full accent-[color:var(--rb-ink)]"
        />
        <output className="w-12 shrink-0 text-right text-sm tabular-nums text-muted">
          {design.heroZoom.toFixed(2)}×
        </output>
      </label>

      <div className="flex gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            onChange(start);
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
