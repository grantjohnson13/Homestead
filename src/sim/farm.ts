/**
 * Farm construction and the small helpers that everything else builds on.
 */

import { STARTING_MOOD, defaultAnimalName, type AnimalKind } from "../data/animals.ts";
import { FEED_ITEM_ID, GOODS, GOOD_IDS } from "../data/items.ts";
import { PLOT_TILES, WREN_HOME } from "../data/map.ts";
import {
  CUSTOMERS,
  DEFAULT_SPEED,
  MAX_EVENTS,
  REPUTATION,
  STAMINA,
  STARTING,
} from "./constants.ts";
import { DEFAULT_ORDERS } from "./orders.ts";
import { poissonInterval } from "./rng.ts";
import { housingFor } from "./upgrades.ts";
import {
  STATE_VERSION,
  type Animal,
  type EventKind,
  type FarmState,
  type GameEvent,
} from "./types.ts";

export const DEFAULT_WREN_NAME = "Wren";

export function createFarm(seed: number, nowMs: number): FarmState {
  const state: FarmState = {
    version: STATE_VERSION,
    seed,
    rngCursor: 0,

    clock: 0,
    speed: DEFAULT_SPEED,
    lastRealMs: nowMs,
    awayMs: 0,
    paused: false,

    gold: STARTING.gold,
    reputation: REPUTATION.start,
    inventory: { ...STARTING.seeds, [FEED_ITEM_ID]: STARTING.feed },
    stand: {},
    // Start at the market reference price, so a farm is sellable out of the box
    // and the player can tune from a sane baseline rather than from zero.
    prices: Object.fromEntries(GOOD_IDS.map((id) => [id, GOODS[id].basePrice])),
    lostSales: [],
    upgrades: {},
    standingOrders: { ...DEFAULT_ORDERS },

    plots: PLOT_TILES.map((tile) => ({
      id: tile.plotId as string,
      x: tile.x,
      y: tile.y,
      tilled: false,
      crop: null,
      progress: 0,
      moisture: 0,
      harvestsDone: 0,
    })),

    animals: [],

    wren: {
      name: DEFAULT_WREN_NAME,
      x: WREN_HOME.x,
      y: WREN_HOME.y,
      facing: "down",
      stamina: STAMINA.max,
      exhausted: false,
      queue: [],
      current: null,
      waterCharges: WATER_CAN_CAPACITY,
      carrying: [],
    },

    customers: [],
    events: [],
    eventsLogged: 0,
    nextCustomerAt: 0,
    certificates: [],
    counters: {},
    awaySummary: null,
  };

  for (let i = 0; i < STARTING.chickens; i++) addAnimal(state, "chicken");
  for (let i = 0; i < STARTING.cows; i++) addAnimal(state, "cow");

  state.nextCustomerAt = poissonInterval(state, CUSTOMERS.baseIntervalMinutes);

  return state;
}

/**
 * How many plots Wren can water before she must refill at the well.
 *
 * Raised from 4 in M6: with a 12-plot field needing regular re-watering, a
 * four-charge can sent her back to the well constantly and walking swallowed the
 * whole day. Eight covers a full pass over the field with one trip.
 */
export const WATER_CAN_CAPACITY = 8;

export function nextId(state: FarmState, prefix: string): string {
  const next = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = next;
  return `${prefix}_${next}`;
}

export function addAnimal(state: FarmState, kind: AnimalKind, name?: string): Animal {
  const existing = state.animals.filter((a) => a.kind === kind).length;
  const animal: Animal = {
    id: nextId(state, kind),
    name: name ?? defaultAnimalName(kind, existing),
    kind,
    mood: STARTING_MOOD,
    fedUntil: 0,
    produceProgress: 0,
    pending: 0,
  };
  state.animals.push(animal);
  return animal;
}

export function animalCapacityLeft(state: FarmState, kind: AnimalKind): number {
  const housed = state.animals.filter((a) => a.kind === kind).length;
  return Math.max(0, housingFor(state, kind) - housed);
}

/* ------------------------------------------------------------------ items -- */

export function countItem(bag: Record<string, number>, id: string): number {
  return bag[id] ?? 0;
}

export function addItem(bag: Record<string, number>, id: string, qty: number): void {
  if (qty <= 0) return;
  bag[id] = countItem(bag, id) + qty;
}

/** Removes up to `qty`; returns how many were actually taken. */
export function takeItem(bag: Record<string, number>, id: string, qty: number): number {
  const have = countItem(bag, id);
  const taken = Math.min(have, Math.max(0, qty));
  if (taken <= 0) return 0;
  if (have - taken <= 0) delete bag[id];
  else bag[id] = have - taken;
  return taken;
}

export function hasItems(bag: Record<string, number>, id: string, qty: number): boolean {
  return countItem(bag, id) >= qty;
}

/* ----------------------------------------------------------------- events -- */

export function logEvent(state: FarmState, kind: EventKind, text: string): void {
  state.events.push({ at: Math.floor(state.clock), kind, text });
  state.eventsLogged += 1;
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
}

/**
 * Events logged since the cursor (a previous `state.eventsLogged` reading).
 * Anything already trimmed out of the rolling window is simply gone.
 */
export function eventsSince(state: FarmState, cursor: number): GameEvent[] {
  const wanted = Math.max(0, state.eventsLogged - cursor);
  if (wanted <= 0) return [];
  return state.events.slice(Math.max(0, state.events.length - wanted));
}

export function findPlot(state: FarmState, plotId: string) {
  return state.plots.find((p) => p.id === plotId);
}

export function findAnimal(state: FarmState, id: string) {
  return state.animals.find((a) => a.id === id || a.name.toLowerCase() === id.toLowerCase());
}
