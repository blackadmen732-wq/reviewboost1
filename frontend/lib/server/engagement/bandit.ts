import "server-only";

import { randomBytes } from "node:crypto";

export interface Arm {
  id: string;
  wins: number;
  losses: number;
}
export interface BanditChoice {
  variant: string;
  source: "cold_start" | "explore" | "thompson";
  snapshot: { version: "beta-bernoulli-v1"; outcomes: number; arms: Arm[] };
}

// Injectable randomness makes statistical behavior reproducible in tests.
const uniform = () => (randomBytes(4).readUInt32BE(0) + 0.5) / 4_294_967_296;

function gamma(shape: number, rng: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempts = 0; attempts < 1000; attempts++) {
    const u1 = Math.max(Number.EPSILON, rng());
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
    let v = 1 + c * z;
    if (v <= 0) continue;
    v = v ** 3;
    const u = Math.max(Number.EPSILON, rng());
    if (
      u < 1 - 0.0331 * z ** 4 ||
      Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))
    )
      return d * v;
  }
  throw new Error("Sampler could not produce a finite draw.");
}

/** Beta(1+wins,1+losses) Thompson sampling. Only completed, accepted-send
 * observation windows enter wins/losses. Pending windows are not failures.
 * The pooled sample threshold and continuing exploration protect cold starts.
 * These are response predictions, not estimates of a message's causal lift. */
export function chooseVariant(
  arms: readonly Arm[],
  rng: () => number = uniform,
): BanditChoice {
  if (
    arms.length < 2 ||
    arms.length > 20 ||
    new Set(arms.map((a) => a.id)).size !== arms.length ||
    arms.some(
      (a) =>
        !a.id ||
        !Number.isSafeInteger(a.wins) ||
        !Number.isSafeInteger(a.losses) ||
        a.wins < 0 ||
        a.losses < 0 ||
        a.wins + a.losses > 10_000_000,
    )
  )
    throw new Error("Invalid learning data.");
  const outcomes = arms.reduce((n, a) => n + a.wins + a.losses, 0);
  const snapshot: BanditChoice["snapshot"] = {
    version: "beta-bernoulli-v1",
    outcomes,
    arms: arms.map((a) => ({ ...a })),
  };
  const randomArm = () =>
    arms[Math.min(arms.length - 1, Math.floor(rng() * arms.length))]!;
  if (outcomes < 20)
    return { variant: randomArm().id, source: "cold_start", snapshot };
  if (rng() < 0.1)
    return { variant: randomArm().id, source: "explore", snapshot };
  let winner = arms[0]!;
  let best = -1;
  for (const arm of arms) {
    const x = gamma(1 + arm.wins, rng);
    const y = gamma(1 + arm.losses, rng);
    const score = x / (x + y);
    if (score > best) {
      best = score;
      winner = arm;
    }
  }
  return { variant: winner.id, source: "thompson", snapshot };
}

/** Wilson intervals describe each observed assignment-window rate. Repeated
 * members and adaptive variants require more analysis before causal claims. */
export function observedRate(converted: number, matured: number) {
  if (
    !Number.isSafeInteger(converted) ||
    !Number.isSafeInteger(matured) ||
    converted < 0 ||
    matured < converted
  )
    throw new Error("Invalid outcome counts.");
  if (matured === 0) return { rate: null, lower: null, upper: null };
  const z = 1.96;
  const p = converted / matured;
  const divisor = 1 + (z * z) / matured;
  const center = (p + (z * z) / (2 * matured)) / divisor;
  const radius =
    (z *
      Math.sqrt((p * (1 - p)) / matured + (z * z) / (4 * matured * matured))) /
    divisor;
  return {
    rate: p,
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius),
  };
}
