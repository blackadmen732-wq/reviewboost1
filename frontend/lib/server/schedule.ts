import "server-only";

import vercelConfig from "@/vercel.json";

/**
 * How often the two workers actually run, read from the schedule that is
 * deployed (`vercel.json`), and how long health waits before calling one
 * stale.
 *
 * Health used to assume the production cadence (dispatch every minute,
 * maintenance every fifteen) while `vercel.json` ran both once a day for
 * Vercel's Hobby plan (docs/SCHEDULING.md). Maintenance was then "stale" for
 * about 23 hours of every day, and an alert that is always red is an alert
 * nobody reads. Reading the deployed schedule keeps the two from drifting:
 * moving to the every-minute cadence on Vercel Pro tightens health with no
 * second change.
 */

export type Worker = "sms_dispatch" | "maintenance";

const WORKER_PATHS: Record<Worker, string> = {
  sms_dispatch: "/api/v1/internal/sms/dispatch",
  maintenance: "/api/v1/internal/maintenance",
};

/** A run can be late by this much without being a missed run. */
const RUN_SLACK_SECONDS = 5 * 60;

/**
 * The interval of a cron expression, in seconds, for the shapes a worker
 * schedule takes. Anything else throws, so an edit to `vercel.json` that this
 * cannot read fails the test that loads every committed schedule rather than
 * quietly widening an alert.
 */
export function cronIntervalSeconds(expression: string): number {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Unreadable worker schedule: "${expression}"`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") {
    throw new Error(`Unreadable worker schedule: "${expression}"`);
  }

  const fixed = /^\d{1,2}$/;
  const step = (field: string) => /^\*\/(\d{1,2})$/.exec(field)?.[1];

  if (minute === "*" && hour === "*") return 60;
  if (step(minute) && hour === "*") return Number(step(minute)) * 60;
  if (fixed.test(minute) && hour === "*") return 60 * 60;
  if (fixed.test(minute) && step(hour)) return Number(step(hour)) * 60 * 60;
  if (fixed.test(minute) && fixed.test(hour)) return 24 * 60 * 60;

  throw new Error(`Unreadable worker schedule: "${expression}"`);
}

function scheduleFor(worker: Worker): string {
  const crons = (vercelConfig as { crons?: Array<{ path: string; schedule: string }> }).crons ?? [];
  const entry = crons.find(({ path }) => path === WORKER_PATHS[worker]);
  if (!entry) throw new Error(`${WORKER_PATHS[worker]} is not scheduled in vercel.json`);
  return entry.schedule;
}

/** Seconds between scheduled runs of a worker, as deployed. */
export function workerIntervalSeconds(worker: Worker): number {
  return cronIntervalSeconds(scheduleFor(worker));
}

/**
 * How long since its last success before health calls a worker stale: one
 * missed run, plus slack for the next one being late.
 */
export function staleAfterSeconds(worker: Worker): number {
  return 2 * workerIntervalSeconds(worker) + RUN_SLACK_SECONDS;
}
