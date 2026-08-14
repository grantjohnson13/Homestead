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
  } else {
    migrate(state);
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

/**
 * Brings a farm saved by an older build up to the current shape.
 *
 * Farms persist indefinitely by design, so a save can predate any field added
 * since. Anything missing is filled with what `createFarm` would have used —
 * without this, a farm saved before the pricing model would throw the first time
 * a customer walked out, because `lostSales` was undefined.
 */
export function migrate(state: FarmState): FarmState {
  const fallback = createFarm(state.seed ?? 1, state.lastRealMs ?? 0);

  if (!state.prices || typeof state.prices !== "object") state.prices = fallback.prices;
  if (!Array.isArray(state.lostSales)) state.lostSales = [];
  if (!state.upgrades || typeof state.upgrades !== "object") state.upgrades = {};
  if (typeof state.speed !== "number" || state.speed <= 0) state.speed = fallback.speed;
  if (!state.standingOrders || typeof state.standingOrders !== "object") {
    state.standingOrders = { ...fallback.standingOrders };
  }
  if (!Array.isArray(state.events)) state.events = [];
  if (typeof state.eventsLogged !== "number") state.eventsLogged = state.events.length;
  // The away budget used to be counted in game-minutes; it is real ms now.
  const legacyAway = (state as unknown as { awayMinutes?: number }).awayMinutes;
  if (typeof state.awayMs !== "number") {
    state.awayMs = typeof legacyAway === "number" ? legacyAway * 1000 : 0;
    delete (state as unknown as { awayMinutes?: number }).awayMinutes;
  }
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  if (!Array.isArray(state.certificates)) state.certificates = [];
  if (!state.stand || typeof state.stand !== "object") state.stand = {};

  // Customers from before the pricing model carry an offer instead of a ceiling.
  for (const customer of state.customers ?? []) {
    const legacy = customer as unknown as { offer?: number; tolerance?: number };
    if (typeof customer.maxPrice !== "number") {
      customer.maxPrice = legacy.tolerance ?? legacy.offer ?? 1;
    }
  }

  // Any good the price list has never heard of falls back to its reference.
  for (const [good, price] of Object.entries(fallback.prices)) {
    if (typeof state.prices[good] !== "number") state.prices[good] = price;
  }

  state.version = fallback.version;
  return state;
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
