/**
 * The clock.
 *
 * `advance` is the only way time passes, and it is pure with respect to its
 * inputs: given the same state and the same tick count it produces the same
 * farm, every time. Nothing in here reads the wall clock — callers pass elapsed
 * time in, which is what makes the whole sim replayable and testable.
 */

import { MAX_EVENTS, OFFLINE_CAP_MINUTES, REAL_MS_PER_TICK } from "./constants.ts";
import { tickPlots } from "./crops.ts";
import { logEvent } from "./farm.ts";
import { tickAnimals } from "./livestock.ts";
import { tickCustomers } from "./market.ts";
import { tickWren } from "./wren.ts";
import type { FarmState, GameEvent } from "./types.ts";

/** Advances the world by `ticks` game-minutes. */
export function advance(state: FarmState, ticks: number): void {
  const count = Math.max(0, Math.floor(ticks));
  for (let i = 0; i < count; i++) {
    state.clock += 1;
    tickPlots(state);
    tickAnimals(state);
    tickWren(state);
    tickCustomers(state);
  }
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
}

export interface CatchUpResult {
  /** Game-minutes actually simulated. */
  simulated: number;
  /** Game-minutes discarded because they exceeded the offline cap. */
  skipped: number;
  /** Set when a meaningful stretch of time was fast-forwarded. */
  summary: string | null;
}

/**
 * Brings a farm up to date after an absence.
 *
 * Only the remaining away budget is simulated; anything beyond it is discarded
 * rather than simulated, so a farm left alone overnight is greeted with a good
 * morning rather than a week of dead customers. The budget is shared with the
 * alarm loop via `state.awayMinutes`, so live ticking and catch-up cannot both
 * spend it.
 */
export function catchUp(state: FarmState, nowMs: number): CatchUpResult {
  const elapsedMs = Math.max(0, nowMs - state.lastRealMs);
  const elapsedMinutes = Math.floor(elapsedMs / REAL_MS_PER_TICK);

  if (elapsedMinutes <= 0) {
    return { simulated: 0, skipped: 0, summary: null };
  }
  state.lastRealMs = nowMs;

  const budget = Math.max(0, OFFLINE_CAP_MINUTES - state.awayMinutes);
  const simulated = Math.min(elapsedMinutes, budget);
  const skipped = elapsedMinutes - simulated;

  const before = snapshotForSummary(state);
  const eventsBefore = state.events.length;

  advance(state, simulated);

  state.awayMinutes += simulated;
  state.paused = state.awayMinutes >= OFFLINE_CAP_MINUTES;

  // Short gaps are just normal play; don't narrate them.
  if (simulated < 5) {
    return { simulated, skipped, summary: null };
  }

  const summary = summarize(state, before, state.events.slice(eventsBefore), simulated, skipped);
  state.awaySummary = summary;
  if (skipped > 0) {
    logEvent(
      state,
      "system",
      `The farm dozed off after ${OFFLINE_CAP_MINUTES} minutes on its own. Time has resumed.`,
    );
  }
  return { simulated, skipped, summary };
}

/**
 * Records that the player just did something: the away budget resets and the
 * world un-pauses. Called once per tool invocation, after catch-up.
 */
export function markPlayerContact(state: FarmState, nowMs: number): void {
  state.awayMinutes = 0;
  state.paused = false;
  state.lastRealMs = nowMs;
}

/** Game-minutes of live ticking still allowed before the world pauses. */
export function remainingAwayBudget(state: FarmState): number {
  return Math.max(0, OFFLINE_CAP_MINUTES - state.awayMinutes);
}

interface SummarySnapshot {
  gold: number;
  reputation: number;
}

function snapshotForSummary(state: FarmState): SummarySnapshot {
  return { gold: state.gold, reputation: state.reputation };
}

function summarize(
  state: FarmState,
  before: SummarySnapshot,
  newEvents: readonly GameEvent[],
  simulated: number,
  skipped: number,
): string {
  const parts: string[] = [];
  parts.push(`While you were away (${simulated} game-minutes):`);

  const counts = new Map<string, number>();
  for (const event of newEvents) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);

  const harvestReady = state.plots.filter(
    (p) => p.crop !== null && p.progress > 0 && p.moisture <= 0,
  ).length;
  const readyToCollect = state.animals.reduce((sum, a) => sum + a.pending, 0);

  const goldDelta = state.gold - before.gold;
  if (goldDelta !== 0) parts.push(`- Gold ${goldDelta > 0 ? "+" : ""}${goldDelta}`);
  const repDelta = Math.round(state.reputation - before.reputation);
  if (repDelta !== 0) parts.push(`- Reputation ${repDelta > 0 ? "+" : ""}${repDelta}`);
  if (state.customers.length > 0) {
    parts.push(`- ${state.customers.length} customer(s) waiting at the stand`);
  }
  if (readyToCollect > 0) parts.push(`- ${readyToCollect} item(s) waiting to be collected`);
  if (harvestReady > 0) parts.push(`- ${harvestReady} plot(s) have dried out and stalled`);
  if ((counts.get("customer") ?? 0) === 0 && goldDelta === 0) {
    parts.push("- A quiet stretch. Nothing much happened.");
  }
  if (skipped > 0) {
    parts.push(`- (${skipped} further minutes passed unsimulated while the farm was paused.)`);
  }

  return parts.join("\n");
}

/** Wall-clock ms until the farm should next be ticked. */
export function msUntilNextTick(ticksPerAlarm: number): number {
  return ticksPerAlarm * REAL_MS_PER_TICK;
}
