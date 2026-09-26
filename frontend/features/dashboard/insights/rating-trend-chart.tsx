"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/utils/cn";

export interface TrendChartPoint {
  /** The local days the point covers, as a person reads them: "Aug 25 – Aug 29". */
  label: string;
  /** Null when too few ratings to average: drawn as a gap, never as zero. */
  average: number | null;
  total: number;
}

/** Where 5 and 1 sit, as a percentage of the plot's height. */
const TOP = 8;
const BOTTOM = 92;
const SCALE = [5, 4, 3, 2, 1] as const;

function yOf(value: number): number {
  return TOP + ((5 - value) / 4) * (BOTTOM - TOP);
}

function xOf(index: number, count: number): number {
  return ((index + 0.5) / count) * 100;
}

function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function ratingsWord(count: number): string {
  return `${count} ${count === 1 ? "rating" : "ratings"}`;
}

/**
 * Average rating over time: one quiet line.
 *
 * The scale is fixed at 1 to 5, so a move from 4.2 to 4.4 looks like what it
 * is — small — rather than filling the chart. One series, in ink: no legend,
 * no colour that could read as good or bad. A stretch with too few ratings
 * breaks the line instead of dropping it to zero, and a point with no
 * neighbour stands alone as a dot.
 *
 * Hover, touch or the arrow keys show one stretch's average and count; every
 * value is also in the table that follows the chart, so nothing depends on
 * pointing at it. Nothing animates.
 *
 * Positions are percentages of the plot box: the chart fills whatever width it
 * is given, at a fixed height, and never scrolls sideways on a small phone.
 * Lines and dots use non-scaling strokes, so stretching the box distorts
 * neither.
 */
export function RatingTrendChart({
  points,
  startLabel,
  endLabel,
  stretchLabel,
}: {
  points: readonly TrendChartPoint[];
  /** First and last day of the period, under the axis. */
  startLabel: string;
  endLabel: string;
  /** What one point covers, for the table caption: "5-day stretch". */
  stretchLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const count = points.length;

  const plotted = points
    .map((point, index) => ({ ...point, index }))
    .filter((point): point is typeof point & { average: number } => point.average !== null);
  const last = plotted.at(-1) ?? null;

  // Consecutive points join; a gap starts a new run.
  const runs: Array<Array<{ x: number; y: number }>> = [];
  let run: Array<{ x: number; y: number }> = [];
  points.forEach((point, index) => {
    if (point.average === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push({ x: xOf(index, count), y: yOf(point.average) });
    }
  });
  if (run.length > 0) runs.push(run);

  const indexAt = (event: PointerEvent<HTMLDivElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    return Math.min(count - 1, Math.max(0, Math.floor(ratio * count)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = active ?? last?.index ?? count - 1;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight") next = Math.min(count - 1, current + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  };

  const shown = active !== null ? points[active] : null;
  const shownX = active !== null ? xOf(active, count) : 0;

  return (
    <figure className="m-0">
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
        {/* The scale, in HTML so the text never stretches with the plot. */}
        <div className="relative h-40" aria-hidden="true">
          {SCALE.map((value) => (
            <span
              key={value}
              className="absolute right-0 -translate-y-1/2 text-xs tabular-nums leading-none text-muted"
              style={{ top: `${yOf(value)}%` }}
            >
              {value}
            </span>
          ))}
        </div>

        <div
          className="relative h-40 touch-pan-y rounded-sm outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          role="img"
          aria-label={`Average rating, ${startLabel} to ${endLabel}. Each value is listed in the table below.`}
          tabIndex={0}
          onPointerMove={(event) => setActive(indexAt(event))}
          onPointerDown={(event) => setActive(indexAt(event))}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActive(null);
          }}
          onFocus={() => setActive((value) => value ?? last?.index ?? null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
            focusable="false"
          >
            {SCALE.map((value) => (
              <line
                key={value}
                x1="0"
                x2="100"
                y1={yOf(value)}
                y2={yOf(value)}
                stroke="var(--rb-border)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {shown ? (
              <line
                x1={shownX}
                x2={shownX}
                y1="0"
                y2="100"
                stroke="var(--rb-muted)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                data-testid="trend-crosshair"
              />
            ) : null}

            {runs.map((segment, index) =>
              segment.length > 1 ? (
                <polyline
                  key={index}
                  points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="var(--rb-ink)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  data-testid="trend-line"
                />
              ) : null,
            )}

            {/* Dots are zero-length strokes with round caps: they stay round
                however the box is stretched. A surface ring keeps them clear of
                the line and the gridlines. */}
            {plotted.map((point) => {
              const d = `M ${xOf(point.index, count)} ${yOf(point.average)} h 0`;
              const on = point.index === active;
              return (
                <g key={point.index} data-testid="trend-point">
                  <path d={d} stroke="var(--rb-surface)" strokeWidth={on ? 16 : 12} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <path d={d} stroke="var(--rb-ink)" strokeWidth={on ? 11 : 8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </svg>

          {/* The latest value, at the end of the line. */}
          {last && active === null ? (
            <span
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+10px)] text-xs font-semibold tabular-nums text-ink"
              style={{ left: `${xOf(last.index, count)}%`, top: `${yOf(last.average)}%` }}
              aria-hidden="true"
            >
              {oneDecimal(last.average)}
            </span>
          ) : null}

          {shown ? (
            <div
              className={cn(
                "pointer-events-none absolute top-0 z-10 w-max max-w-[12rem] rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 shadow-[var(--shadow-control)]",
                shownX > 66 ? "-translate-x-full" : shownX < 34 ? "translate-x-0" : "-translate-x-1/2",
              )}
              style={{ left: `${shownX}%` }}
              aria-hidden="true"
              data-testid="trend-tooltip"
            >
              {shown.average !== null ? (
                <p className="text-base font-semibold tabular-nums text-ink">{oneDecimal(shown.average)}</p>
              ) : (
                <p className="text-sm font-medium text-ink">Too few to average</p>
              )}
              <p className="text-xs text-muted">{shown.label}</p>
              <p className="text-xs text-muted">{ratingsWord(shown.total)}</p>
            </div>
          ) : null}
        </div>

        <div aria-hidden="true" />
        <div className="mt-2 flex justify-between gap-4 text-xs text-muted" aria-hidden="true">
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      </div>

      <table className="sr-only">
        <caption>Average rating by {stretchLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Days</th>
            <th scope="col">Average rating</th>
            <th scope="col">Ratings</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{point.average !== null ? oneDecimal(point.average) : "Too few to average"}</td>
              <td>{point.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
