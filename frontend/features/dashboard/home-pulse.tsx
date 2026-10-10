import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { MIN_SAMPLE, type FeedbackInsights, type TrendPoint } from "@/lib/owner/insights";

/**
 * What happened, in about two seconds.
 *
 * An owner reads this between customers. Three numbers, a line that goes up or
 * down, and one bar showing the split — then they are back on the floor. The
 * long version is still Feedback → Insights, one tap away.
 *
 * WHY GREEN AND AMBER, AND NOT GREEN AND RED
 * ------------------------------------------
 * This is an ordered sentiment scale, so the form is a diverging stacked bar
 * centred on neutral, and the colour job is diverging: two opposite hues with
 * a grey midpoint.
 *
 * The obvious pair is the product's green against its danger red. Measured,
 * #007a4d against #b33a3a is ΔE 5.0 under deuteranopia — below even the 6–8
 * floor that secondary encoding can rescue. A red-green colourblind owner,
 * which is roughly one man in twelve, could not tell their happy customers
 * from their unhappy ones. So the second pole is the star amber the palette
 * already carries: #007a4d against #b97d0c measures ΔE 9.0 protan, 24.1
 * tritan, 20.9 normal — every check passes, and no colour was added.
 *
 * Amber is also the more honest word. Red says failure, and this product does
 * not treat a two-star as a failure to be suppressed; amber says look at this.
 *
 * Identity never rests on colour alone: every segment carries its own label
 * and count, and the keys below repeat them.
 */

/** 4–5 stars, 3 stars, 1–2 stars. The split an owner actually acts on. */
function split(counts: Record<1 | 2 | 3 | 4 | 5, number>) {
  const happy = counts[5] + counts[4];
  const ok = counts[3];
  const unhappy = counts[2] + counts[1];
  return { happy, ok, unhappy, total: happy + ok + unhappy };
}

/** Honest rounding: the three shares are forced to total exactly 100. */
function shares(happy: number, unhappy: number, total: number) {
  const h = Math.round((happy / total) * 100);
  const u = Math.round((unhappy / total) * 100);
  return { h, o: Math.max(0, 100 - h - u), u };
}

const BAND_W = 600;
/** The smallest span the band will draw, in stars. */
const MIN_SPAN = 1;
const BAND_H = 96;

/**
 * The daily average, drawn as one series.
 *
 * A point with no ratings has a null average and is a gap, never a zero — a
 * zero would be a day everybody hated the place, which is a different claim
 * from a day nobody came in. So the line is drawn as one path per run of
 * consecutive days that have ratings.
 */
function TrendBand({ points }: { points: TrendPoint[] }) {
  const rated = points.filter((p) => p.average !== null);
  if (rated.length < 2) return null;

  // THE SCALE, AND WHY IT IS NOT 1–5
  //
  // Pinned to the full star range, a month of averages between 3.9 and 4.8
  // is a flat line — which answers "are we good" and hides the only thing
  // this band is for, which is "are we going up or down".
  //
  // So the band fits the data, with a floor of one whole star of span so a
  // quiet week cannot be magnified into a cliff, clamped to the real 1–5
  // range. A fitted scale is only honest if it is stated, so both ends are
  // printed beside the line.
  const lows = rated.map((p) => p.average as number);
  const lo = Math.min(...lows);
  const hi = Math.max(...lows);
  const pad = Math.max(0, (MIN_SPAN - (hi - lo)) / 2);
  const min = Math.max(1, Math.min(lo - pad, 5 - MIN_SPAN));
  const max = Math.min(5, Math.max(hi + pad, min + MIN_SPAN));
  const x = (i: number) => (i / (points.length - 1)) * BAND_W;
  const y = (v: number) => BAND_H - 6 - ((v - min) / (max - min || 1)) * (BAND_H - 16);

  // One run per stretch of consecutive rated days.
  const runs: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  points.forEach((p, i) => {
    if (p.average === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v: p.average });
    }
  });
  if (run.length) runs.push(run);

  const last = runs.at(-1)?.at(-1);

  return (
    <div className="relative mt-5">
      <div className="mb-1.5 flex items-baseline justify-between text-[0.6875rem] text-muted">
        <span>Average rating, last {points.length} days</span>
        <span className="tabular-nums">
          {min.toFixed(1)}–{max.toFixed(1)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${BAND_W} ${BAND_H}`}
        preserveAspectRatio="none"
        className="block h-[96px] w-full"
        role="img"
        aria-label={`Average rating over the last ${points.length} days, ${(rated.at(-1)?.average ?? 0).toFixed(1)} most recently.`}
      >
        {/* Recessive hairline, solid, one step off the surface. */}
        <line
          x1="0"
          y1={BAND_H - 6}
          x2={BAND_W}
          y2={BAND_H - 6}
          stroke="var(--rb-border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {runs.map((r, n) => {
          const line = r.map(({ i, v }, k) => `${k === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
          const area = `${line} L${x(r.at(-1)!.i)},${BAND_H - 6} L${x(r[0]!.i)},${BAND_H - 6} Z`;
          return (
            <g key={n}>
              {/* The wash: the series hue at ~10%, never a saturated block. */}
              <path d={area} fill="var(--rb-brand)" className="rb-pulse-area" />
              <path
                d={line}
                fill="none"
                stroke="var(--rb-brand-text)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                className="rb-pulse-line"
              />
            </g>
          );
        })}
      </svg>

      {/* The end marker is HTML so it stays round under the band's
          non-uniform scaling, and so its 2px surface ring is a real ring. */}
      {last ? (
        <span
          aria-hidden="true"
          className="rb-pulse-dot absolute size-[10px] rounded-full bg-[color:var(--rb-brand-text)] ring-2 ring-[color:var(--rb-surface)]"
          style={{
            left: `${(x(last.i) / BAND_W) * 100}%`,
            top: `${(y(last.v) / BAND_H) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ) : null}
    </div>
  );
}

export function HomePulse({ insights }: { insights: FeedbackInsights }) {
  const { happy, ok, unhappy, total } = split(insights.current.counts);
  if (total === 0) return null;

  const enough = total >= MIN_SAMPLE;
  const pct = shares(happy, unhappy, total);

  const segments = [
    { key: "happy", label: "Happy", sub: "4–5 stars", n: happy, pct: pct.h, fill: "var(--rb-brand-text)", ink: "#ffffff" },
    { key: "ok", label: "OK", sub: "3 stars", n: ok, pct: pct.o, fill: "var(--rb-border-strong)", ink: "#171a18" },
    { key: "unhappy", label: "Unhappy", sub: "1–2 stars", n: unhappy, pct: pct.u, fill: "var(--rb-star)", ink: "#ffffff" },
  ].filter((s) => s.n > 0);

  return (
    <section
      className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]"
      aria-labelledby="home-pulse-heading"
    >
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 id="home-pulse-heading" className="text-sm font-medium text-muted">
          Last 30 days
        </h2>
        <Link
          href="/feedback/insights"
          className="group inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          View insights
          <ChevronRight aria-hidden="true" className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Three numbers. Proportional figures, not tabular: these are standalone
          values, and tabular-nums makes a number like 121 look loose at size. */}
      {/* Three columns, not a wrapping row: on a 390pt phone the row broke
          2 + 1 and the three numbers stopped reading as one glance. Labels
          wrap; the numbers stay on one line together. */}
      <dl className="grid grid-cols-3 gap-x-4">
        <div>
          <dd className="text-[length:var(--rb-text-display)] font-semibold leading-none tracking-[-0.03em] text-ink">
            {insights.todayTotal}
          </dd>
          <dt className="mt-1.5 text-sm text-muted">Sent to Google today</dt>
        </div>
        <div>
          <dd className="text-[length:var(--rb-text-display)] font-semibold leading-none tracking-[-0.03em] text-ink">
            {enough ? `${pct.h}%` : happy}
          </dd>
          <dt className="mt-1.5 text-sm text-muted">Happy{enough ? null : <> of {total}</>}</dt>
        </div>
        <div>
          <dd className="text-[length:var(--rb-text-display)] font-semibold leading-none tracking-[-0.03em] text-ink">
            {enough ? `${pct.u}%` : unhappy}
          </dd>
          <dt className="mt-1.5 text-sm text-muted">Unhappy{enough ? null : <> of {total}</>}</dt>
        </div>
      </dl>

      <TrendBand points={insights.trend} />

      {/* The split. 2px surface gaps do the separating — never a stroke. */}
      <div className="mt-6 flex h-5 gap-[2px] overflow-hidden" role="img" aria-label={segments.map((s) => `${s.label}, ${s.n} of ${total}`).join(". ")}>
        {segments.map((s, i) => (
          <span
            key={s.key}
            className="rb-pulse-seg grid place-items-center overflow-visible first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(s.n / total) * 100}%`,
              background: s.fill,
              animationDelay: `${120 + i * 70}ms`,
            }}
          >
            {/* Only where it genuinely fits: a clipped label is worse than none. */}
            {s.pct >= 18 ? (
              <span className="text-[0.6875rem] font-semibold leading-none" style={{ color: s.ink }}>
                {s.pct}%
              </span>
            ) : null}
          </span>
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm text-muted">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: s.fill }} />
            <span className="text-ink">{s.label}</span>
            <span className="tabular-nums">{s.n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
