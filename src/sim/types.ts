/**
 * The shape of a farm. This is the single source of truth: everything the UI
 * draws and everything a tool reports is derived from a `FarmState`, and the
 * whole thing round-trips through JSON for Durable Object storage.
 */

import type { AnimalKind } from "../data/animals.ts";
import type { CropId } from "../data/crops.ts";
import type { GoodId } from "../data/items.ts";
import type { Point } from "../data/map.ts";

export const STATE_VERSION = 1;

export type Facing = "up" | "down" | "left" | "right";

export type TaskType =
  "till" | "plant" | "water" | "harvest" | "feed" | "collect" | "restock" | "pet" | "idle";

/**
 * Targets accepted by tasks:
 *   - "plot_1".."plot_12"     for till / plant / water / harvest
 *   - an animal id            for feed / pet
 *   - "all_chickens" | "all_cows" | "all_animals"  for feed / pet / collect
 *   - a good id ("egg", "tomato") or "all"         for restock
 */
/**
 * What Wren does with herself when you have not told her anything.
 *
 * The player's job is meant to be strategy — what to grow, what to charge, what
 * to invest in — not deciding which bed needs water this minute.
 */
export interface StandingOrders {
  /** When off, Wren does nothing unless told. */
  enabled: boolean;
  /** A crop id, "auto" to plant for best return, or "none" to stop sowing. */
  plant: CropId | "auto" | "none";
  /** Whether she may spend gold on seed and feed to keep going. */
  buySupplies: boolean;
  /** Gold she will never spend below, so investments stay your call. */
  reserve: number;
  /** Whether to keep carrying goods out to the stand. */
  keepStandStocked: boolean;
}

/** A task as described by a caller, before validation. */
export interface TaskInput {
  type: string;
  target?: string;
  crop?: string;
  qty?: number;
}

export interface QueuedTask {
  id: string;
  type: TaskType;
  target?: string;
  /** Which crop to sow (plant only). */
  crop?: CropId;
  /** How many units to carry (restock only); omitted means "as many as fit". */
  qty?: number;
}

export type LegAction =
  | "till"
  | "plant"
  | "water"
  | "refill"
  | "harvest"
  | "feed"
  | "collect"
  | "load"
  | "unload"
  | "pet"
  | "rest";

/**
 * Tasks compile down to a list of legs — "walk here, work for N ticks". A
 * watering trip with an empty can becomes two legs (well, then plot); a restock
 * becomes two (barn, then stand). Everything else is one.
 */
export interface Leg {
  x: number;
  y: number;
  workTicks: number;
  action: LegAction;
  /** Set on feed/pet/collect legs so the effect knows which barnyard it is at. */
  kind?: AnimalKind;
}

export interface ActiveTask {
  task: QueuedTask;
  legs: Leg[];
  legIndex: number;
  /** Remaining steps of the current leg's walk, excluding the tile she's on. */
  path: Point[];
  /** Work ticks completed on the current leg. */
  workDone: number;
}

export interface WrenState {
  name: string;
  x: number;
  y: number;
  facing: Facing;
  stamina: number;
  /**
   * Latched when stamina bottoms out; cleared only once she has rested back to
   * STAMINA.resumeAt. Without the latch she would flicker in and out of working
   * one tick at a time.
   */
  exhausted: boolean;
  queue: QueuedTask[];
  current: ActiveTask | null;
  /** Waterings left in the can before she must visit the well. */
  waterCharges: number;
  /** Goods in hand during a restock trip. */
  carrying: { good: GoodId; qty: number }[];
}

export interface Plot {
  id: string;
  x: number;
  y: number;
  tilled: boolean;
  crop: CropId | null;
  /** Watered game-minutes accumulated toward the current harvest. */
  progress: number;
  /** Remaining game-minutes of moisture; growth only accrues while > 0. */
  moisture: number;
  /** How many harvests have already been taken from this planting. */
  harvestsDone: number;
}

export interface Animal {
  id: string;
  name: string;
  kind: AnimalKind;
  /** 0-100; see MOOD_BANDS. */
  mood: number;
  /** Game-clock time until which this animal counts as fed. */
  fedUntil: number;
  /** Fed minutes accumulated toward the next unit of produce. */
  produceProgress: number;
  /**
   * Produce that has been made but not yet collected. It sits with the animal
   * until Wren runs a `collect` task, which is what makes that task matter.
   */
  pending: number;
}

export interface CustomerWant {
  good: GoodId;
  qty: number;
}

export interface Customer {
  id: string;
  name: string;
  /** Index into the UI's portrait set. */
  portrait: number;
  wants: CustomerWant[];
  /**
   * The most this customer would pay for their whole basket. Never revealed
   * while they are at the stand — learning the market by losing the occasional
   * sale is the point — but disclosed afterwards in the lost-sale log.
   */
  maxPrice: number;
  arrivedAt: number;
  /** Game-minutes they will wait in total. */
  patience: number;
  spot: Point;
}

/** Why a customer left without buying. */
export type LostSaleReason = "price" | "stock";

export interface LostSale {
  at: number;
  customer: string;
  reason: LostSaleReason;
  wants: CustomerWant[];
  /** What your price list came to for their basket. */
  yourPrice: number;
  /** What they would have paid. Only meaningful when reason is "price". */
  theirMax: number;
  /** Goods the stand was short of, when reason is "stock". */
  missing: string[];
}

export type EventKind = "crop" | "animal" | "customer" | "wren" | "economy" | "system";

export interface GameEvent {
  /** Game-clock minute the event happened at. */
  at: number;
  kind: EventKind;
  text: string;
}

export interface FarmState {
  version: number;
  /** Stable per-farm RNG seed. */
  seed: number;
  /** Advances every random draw, so replays are exact. */
  rngCursor: number;

  /** Game-minutes elapsed since the farm was created. */
  clock: number;
  /**
   * How many game-minutes pass per real second. Scales the whole world
   * uniformly, so balance is unaffected — only how quickly you watch it happen.
   */
  speed: number;
  /** Wall-clock ms at the last tick, used to catch up after an absence. */
  lastRealMs: number;
  /**
   * Real milliseconds of ticking spent since the player last did anything. The
   * alarm loop and offline catch-up draw on the same OFFLINE_CAP_REAL_MS
   * budget, so an absence costs the same whether the world was ticking live or
   * was fast-forwarded on return — never both.
   *
   * Real time rather than game-minutes, because the budget has to mean the same
   * thing at 0.5x as at 360x.
   */
  awayMs: number;
  /** True once the away budget is spent and the world has stopped. */
  paused: boolean;

  gold: number;
  reputation: number;
  /** Barn storage: harvested goods and bought supplies. */
  inventory: Record<string, number>;
  /** Goods carried out to the farm stand, where customers can buy them. */
  stand: Record<string, number>;
  /**
   * What you charge per unit, by good id. Customers buy on their own when your
   * price is at or under what they were willing to pay, so this is the main
   * economic lever — set it once and it applies to everyone.
   */
  prices: Record<string, number>;
  /** Recent customers who left without buying, and why. Trimmed like events. */
  lostSales: LostSale[];
  /** Investments made, by upgrade id, as a level (absent or 0 = not bought). */
  upgrades: Record<string, number>;
  /** What Wren does on her own initiative when her queue runs dry. */
  standingOrders: StandingOrders;

  plots: Plot[];
  animals: Animal[];
  wren: WrenState;
  customers: Customer[];

  /** Rolling log; trimmed to MAX_EVENTS. */
  events: GameEvent[];
  /**
   * Total events ever logged, including ones since trimmed away. Tools use this
   * as a cursor: an index into `events` would silently break the moment the log
   * is trimmed, which is exactly when a lot has happened.
   */
  eventsLogged: number;
  /** Clock minute at which the next customer is due. */
  nextCustomerAt: number;
  /** Flavour unlocks earned by reputation. */
  certificates: string[];
  /** Monotonic counters behind generated ids. */
  counters: Record<string, number>;
  /** Set when a catch-up simulation ran; consumed by the next tool result. */
  awaySummary: string | null;
}
