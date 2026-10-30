"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/utils/cn";

export interface TrendChartPoint {
  /** The day or days it covers, as the readout says them: "Sep 18", "Sep 8 – Sep 14". */
  label: string;
  /** The short date under the axis when this point carries a tick: "Sep 18". */
  tick: string;
  /** Null when nobody rated in it: a gap, never a zero and never interpolated. */
  average: number | null;
  total: number;
}

/** Where the top and bottom of the scale sit, as a percentage of the plot's height. */
const TOP = 6;
const BOTTOM = 94;

function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function ratingsWord(count: number): string {
  return `${count} ${count === 1 ? "rating" : "ratings"}`;
}

/**
 * Which points get a date under the axis: about five, never every day. Counted
 * back from the most recent point, so yesterday is always labelled and a 30-day
 * view reads a week apart: Aug 26 · Sep 2 · Sep 9 · Sep 16 · Sep 23.
 */
function tickIndices(count: number, unit: "day" | "week"): number[] {
  const step = unit === "day" ? (count <= 7 ? 2 : 7) : count <= 6 ? 1 : Math.ceil(count / 5);
  const ticks: number[] = [];
  for (let index = count - 1; index >= 0; index -= step) ticks.unshift(index);
  return ticks;
}

/**
 * Average rating over time.
 *
 * TRUTHFUL FIRST
 * --------------
 * - Every point is a real day (or week) of ratings. A day nobody rated is a
 *   gap; the line never crosses it and nothing is interpolated.
 * - Segments are straight, joins softened only at the corner: no smoothing
 *   curve implying ratings that happened between measurements.
 * - The top of the scale is always 5 and the bottom is 3, or lower when the
 *   data goes lower — always a whole-number rating with a labelled gridline at
 *   every whole number in between. A 0.2 change is at most a tenth of the
 *   chart: visible, never dramatic. The scale is never fitted to the data.
 *
 * READABLE SECOND
 * ---------------
 * Tall enough that a rise from 4.1 to 4.4 is something you can see; a faint
 * ink wash under the line; dots only where they carry something (every day
 * of a week, isolated points, the latest point, the one you are on); about
 * five dates along the bottom. Pointing, tapping or the arrow keys give the
 * day, its average and how many ratings it rests on. One series in ink, no
 * colour that reads as good or bad.
 *
 * The line is never drawn in on arrival and nothing loops. The readout fades
 * in over 120ms when it first appears and then follows the pointer exactly;
 * a readout that lagged behind the finger would be a readout of the wrong day.
 *
 * Positions are percentages of the plot box, so it fills any width at a fixed
 * height and never scrolls sideways; strokes don't scale with the box.
 */
export function RatingTrendChart({
  points,
  unit,
  caption,
}: {
  points: readonly TrendChartPoint[];
  unit: "day" | "week";
  /** For the table view: "Average rating by day, Aug 26 to Sep 24". */
  caption: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const count = points.length;

  const values = points.flatMap((point) => (point.average === null ? [] : [point.average]));
  const floor = Math.min(3, Math.floor(Math.min(...values, 5)));
  const scale: number[] = [];
  for (let value = 5; value >= floor; value -= 1) scale.push(value);

  const yOf = (value: number) => TOP + ((5 - value) / (5 - floor)) * (BOTTOM - TOP);
  const xOf = (index: number) => ((index + 0.5) / count) * 100;

  // Consecutive rated points join; a gap starts a new run.
  const runs: Array<Array<{ index: number; x: number; y: number }>> = [];
  let run: Array<{ index: number; x: number; y: number }> = [];
  points.forEach((point, index) => {
    if (point.average === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push({ index, x: xOf(index), y: yOf(point.average) });
    }
  });
  if (run.length > 0) runs.push(run);

  const lastIndex = runs.at(-1)?.at(-1)?.index ?? null;
  const areaRun = Math.max(3, Math.ceil(count / 4));
  const everyDot = unit === "day" && count <= 7;
  const dotted = new Set<number>();
  for (const segment of runs) {
    for (const point of segment) {
      if (everyDot || segment.length === 1 || point.index === lastIndex) dotted.add(point.index);
    }
  }
  if (active !== null && points[active]?.average !== null) dotted.add(active);

  const indexAt = (event: PointerEvent<HTMLDivElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    return Math.min(count - 1, Math.max(0, Math.floor(ratio * count)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = active ?? lastIndex ?? count - 1;
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
  const shownX = active !== null ? xOf(active) : 0;
  const last = lastIndex !== null ? points[lastIndex] : null;
  // The latest value sits above its dot, or below when the line arrives from
  // above, so it never lands on the line.
  const before = lastIndex !== null && lastIndex > 0 ? points[lastIndex - 1]?.average ?? null : null;
  const labelBelow = last?.average != null && before !== null && before > last.average;
  const edge = (x: number) => (x > 80 ? "-translate-x-full" : x < 20 ? "translate-x-0" : "-translate-x-1/2");

  return (
    <figure className="m-0">
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
        {/* The scale, in HTML so its text never stretches with the plot. */}
        <div className="relative h-40 sm:h-52" aria-hidden="true">
          {scale.map((value) => (
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
          className="relative h-40 touch-pan-y rounded-sm outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] sm:h-52"
          role="img"
          aria-label={`${caption}. Each value is listed in the table below.`}
          tabIndex={0}
          onPointerMove={(event) => setActive(indexAt(event))}
          onPointerDown={(event) => setActive(indexAt(event))}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActive(null);
          }}
          onFocus={() => setActive((value) => value ?? lastIndex)}
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
            {scale.map((value) => (
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

            {/* A barely-there wash under runs long enough to read as a line: depth,
                not a second series. Under short runs between gaps it read as
                blocks, so those go without. */}
            {runs.map((segment, index) =>
              segment.length >= areaRun ? (
                <polygon
                  key={`area-${index}`}
                  points={[
                    ...segment.map((point) => `${point.x},${point.y}`),
                    `${segment.at(-1)!.x},${BOTTOM}`,
                    `${segment[0]!.x},${BOTTOM}`,
                  ].join(" ")}
                  fill="var(--rb-ink)"
                  fillOpacity="0.035"
                  data-testid="trend-area"
                />
              ) : null,
            )}

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
                  key={`line-${index}`}
                  points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="var(--rb-ink)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  data-testid="trend-line"
                />
              ) : null,
            )}

            {/* Dots are zero-length strokes with round caps, so they stay round
                however the box stretches; a surface ring lifts them off the line. */}
            {[...dotted].map((index) => {
              const value = points[index]?.average;
              if (value === null || value === undefined) return null;
              const d = `M ${xOf(index)} ${yOf(value)} h 0`;
              const on = index === active;
              return (
                <g key={index} data-testid="trend-point">
                  <path d={d} stroke="var(--rb-surface)" strokeWidth={on ? 16 : 12} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <path d={d} stroke="var(--rb-ink)" strokeWidth={on ? 11 : 8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </svg>

          {/* The latest value, at the end of the line, while nothing is pointed at. */}
          {last && last.average !== null && active === null ? (
            <span
              className={cn(
                "pointer-events-none absolute text-xs font-semibold tabular-nums text-ink",
                labelBelow ? "translate-y-[10px]" : "-translate-y-[calc(100%+10px)]",
                edge(xOf(lastIndex!)),
              )}
              style={{ left: `${xOf(lastIndex!)}%`, top: `${yOf(last.average)}%` }}
              aria-hidden="true"
            >
              {oneDecimal(last.average)}
            </span>
          ) : null}

          {shown ? (
            <div
              className={cn(
                "animate-fade-in pointer-events-none absolute top-0 z-10 w-max max-w-[12rem] rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 shadow-[var(--shadow-control)]",
                edge(shownX),
              )}
              style={{ left: `${shownX}%` }}
              aria-hidden="true"
              data-testid="trend-tooltip"
            >
              <p className="text-xs font-medium text-muted">{shown.label}</p>
              {shown.average !== null ? (
                <>
                  <p className="text-base font-semibold tabular-nums text-ink">
                    {oneDecimal(shown.average)} average
                  </p>
                  <p className="text-xs text-muted">{ratingsWord(shown.total)}</p>
                </>
              ) : (
                <p className="text-sm font-medium text-ink">No ratings</p>
              )}
            </div>
          ) : null}
        </div>

        <div aria-hidden="true" />
        <div className="relative mt-2 h-4 text-xs text-muted" aria-hidden="true">
          {tickIndices(count, unit).filter((index) => points[index]?.tick).map((index) => (
            <span
              key={index}
              className={cn("absolute top-0 whitespace-nowrap", edge(xOf(index)))}
              style={{ left: `${xOf(index)}%` }}
              data-testid="trend-tick"
            >
              {points[index]?.tick}
            </span>
          ))}
        </div>
      </div>

      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{unit === "day" ? "Day" : "Week"}</th>
            <th scope="col">Average rating</th>
            <th scope="col">Ratings</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{point.average !== null ? oneDecimal(point.average) : "No ratings"}</td>
              <td>{point.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
