/**
 * Deterministic randomness.
 *
 * The sim must be reproducible from (state, seed, elapsed ticks), so nothing may
 * call Math.random(). Every draw advances `rngCursor`, which lives in the farm
 * state, so replaying the same inputs replays the same farm exactly — including
 * customer arrivals, yields and grumpy-hen skips.
 */

export interface RngHost {
  seed: number;
  rngCursor: number;
}

/** SplitMix-style integer avalanche: good spread from consecutive counters. */
function mix32(input: number): number {
  let z = input | 0;
  z = (z + 0x9e3779b9) | 0;
  z ^= z >>> 16;
  z = Math.imul(z, 0x21f0aaad);
  z ^= z >>> 15;
  z = Math.imul(z, 0x735a2d97);
  z ^= z >>> 15;
  return z >>> 0;
}

/** Next float in [0, 1). */
export function rand(host: RngHost): number {
  host.rngCursor = (host.rngCursor + 1) | 0;
  return mix32(host.seed ^ Math.imul(host.rngCursor, 0x85ebca6b)) / 0x100000000;
}

/** Integer in [min, max], inclusive. */
export function randInt(host: RngHost, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rand(host) * (max - min + 1));
}

/** True with the given probability. */
export function chance(host: RngHost, probability: number): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  return rand(host) < probability;
}

export function pick<T>(host: RngHost, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick() from an empty list");
  return items[randInt(host, 0, items.length - 1)] as T;
}

/**
 * Exponential inter-arrival time for a Poisson process with the given mean.
 * Clamped so a very unlucky draw cannot stall arrivals for an implausibly long
 * stretch (or fire two customers in the same minute).
 */
export function poissonInterval(host: RngHost, meanMinutes: number): number {
  const u = Math.max(rand(host), 1e-9);
  const raw = -Math.log(u) * meanMinutes;
  return Math.min(Math.max(Math.round(raw), 1), Math.ceil(meanMinutes * 3));
}

/** A fresh seed for a brand-new farm. Only called outside the sim. */
export function makeSeed(entropy: number): number {
  return mix32(entropy) | 0;
}
