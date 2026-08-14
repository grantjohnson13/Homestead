/**
 * The seam between the tools and wherever a farm actually lives.
 *
 * M2 runs the tools against an in-memory store; M3 swaps in Durable Object
 * storage. Nothing in `tools/` knows which it is talking to.
 */

import {
  catchUp,
  createFarm,
  makeSeed,
  markPlayerContact,
  type CatchUpResult,
  type FarmState,
} from "../sim/index.ts";

export interface FarmStore {
  /** Current wall-clock time in ms. Injected so tests can control it. */
  now(): number;
  read(): Promise<FarmState | null>;
  write(state: FarmState): Promise<void>;
}

/**
 * Loads the farm, brings it up to date with real elapsed time, and hands it to
 * `mutate`. Whatever `mutate` returns is passed back alongside the farm.
 *
 * Every tool goes through here, so catch-up and persistence are impossible to
 * forget.
 */
export async function withFarm<T>(
  store: FarmStore,
  mutate: (state: FarmState) => T | Promise<T>,
): Promise<{ state: FarmState; result: T; caughtUp: CatchUpResult; eventCursor: number }> {
  const now = store.now();
  let state = await store.read();

  if (!state) {
    state = createFarm(makeSeed(now), now);
  }

  // Read the cursor *before* catching up: everything that happened during the
  // gap is exactly the news this call should report. Reading it afterwards
  // silently swallowed the passage of time.
  const eventCursor = state.eventsLogged;
  const caughtUp = catchUp(state, now);
  // The player is here, so the away budget resets and the world resumes.
  markPlayerContact(state, now);

  const result = await mutate(state);
  await store.write(state);

  return { state, result, caughtUp, eventCursor };
}

/** A store backed by a plain variable. Used by tests and by local development. */
export class MemoryFarmStore implements FarmStore {
  private state: FarmState | null = null;
  private clock: number;

  constructor(startMs = 0) {
    this.clock = startMs;
  }

  now(): number {
    return this.clock;
  }

  /** Moves the wall clock forward, which is how tests make game time pass. */
  advanceRealMs(ms: number): void {
    this.clock += ms;
  }

  async read(): Promise<FarmState | null> {
    return this.state ? (JSON.parse(JSON.stringify(this.state)) as FarmState) : null;
  }

  async write(state: FarmState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state)) as FarmState;
  }

  /** Replaces the farm outright — used by new_farm. */
  async reset(state: FarmState | null): Promise<void> {
    this.state = state;
  }
}
