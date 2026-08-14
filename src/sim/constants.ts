/**
 * Every tunable number in one place. M6's balance pass edits this file and
 * `data/crops.ts` — nothing else.
 *
 * The sim's atomic unit is one tick = one game-minute. One real second is one
 * game-minute, and the Durable Object alarm advances 5 ticks at a time.
 */

export const TICKS_PER_ALARM = 5;
export const REAL_MS_PER_TICK = 1000;

/**
 * How fast the world runs, as a multiple of one game-minute per real second.
 *
 * The scaling is deliberately uniform: crops, Wren, animals and customers all
 * speed up together, so the balance holds at every setting. That works only
 * because the stand sells itself now — when selling needed a per-customer
 * decision, speeding the world up would have made customers expire faster than
 * a person could answer. With a standing price list the player is never racing
 * the clock, so faster is simply livelier.
 */
export const SPEED_OPTIONS = [0.5, 1, 2, 4, 8] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];

export const DEFAULT_SPEED = 1;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 8;

export const SPEED_LABELS: Record<string, string> = {
  "0.5": "half speed — a slow afternoon",
  "1": "normal — one game-minute per second",
  "2": "brisk",
  "4": "fast — the day rattles along",
  "8": "very fast — blink and you'll miss it",
};

/**
 * Wren's stamina economy.
 *
 * Tuned in M6. The first pass drained 1.6/tick against 3-tick tasks, which meant
 * a single pass over the field cost more than her whole stamina bar: she was
 * permanently exhausted and any strategy beyond four plots was strictly worse
 * than doing less. Stamina should be a reason to pace yourself, not a wall.
 */
export const STAMINA = {
  max: 100,
  /** Drained per tick of actual work (not walking). */
  workDrainPerTick: 0.9,
  /** Drained per tick of walking. */
  walkDrainPerTick: 0.25,
  /** Recovered per tick while idle at the farmhouse. */
  restRecoverPerTick: 3,
  /** Recovered per tick while idle anywhere else. */
  idleRecoverPerTick: 1.2,
  /** Below this she refuses to start new work. */
  refuseBelow: 8,
  /** She will not accept work again until rested back to here. */
  resumeAt: 30,
} as const;

/**
 * How long each task's *work* phase takes, in ticks, once Wren has arrived.
 * Walking dominates the cost of a job, so these are deliberately short — the
 * interesting decision is what to send her to, not how long she stands there.
 */
export const TASK_WORK_TICKS = {
  till: 2,
  plant: 1,
  water: 1,
  harvest: 2,
  feed: 1,
  collect: 1,
  restock: 2,
  pet: 1,
  idle: 1,
} as const;

/** Wren walks one tile per tick. */
export const TICKS_PER_TILE = 1;

/**
 * Customer arrivals and patience.
 *
 * These are the one set of numbers that cannot be tuned against simulated time
 * alone, because the clock on the other side of them is a human reading a
 * message and typing a reply. At one real second per game-minute, the brief's
 * ~10-minute patience gave a player ten real seconds to notice a customer,
 * decide a price, and possibly send Wren to restock the stand — so every
 * customer timed out and reputation only ever fell. Playtesting caught what the
 * balance tests could not: they served customers programmatically in the same
 * tick, so patience never bit.
 *
 * Patience now covers a conversational turn plus a restock trip; arrivals are
 * spaced so roughly one new customer appears per turn rather than four.
 */
export const CUSTOMERS = {
  /** Mean game-minutes between arrivals at reputation 50 (~50 real seconds). */
  baseIntervalMinutes: 50,
  /** At reputation 100 arrivals are this multiple as frequent (lower = faster). */
  intervalAtMaxRep: 0.6,
  /** At reputation 0 arrivals are this multiple as frequent. */
  intervalAtMinRep: 1.8,
  /** Game-minutes a customer waits before leaving (~2.5 real minutes). */
  patienceMinutes: 150,
  /** Most customers waiting at once. */
  maxWaiting: 4,
} as const;

/** Reputation movement. */
export const REPUTATION = {
  start: 50,
  min: 0,
  max: 100,
  /** Gained for a sale. */
  perSale: 3,
  /**
   * Lost when someone leaves because your prices were too high. Milder than an
   * empty shelf: charging a premium is a strategy, not a failure, but word does
   * get round that you are dear.
   */
  perPriceWalkout: -1,
  /** Lost when a customer leaves because the stand could not fill their order. */
  perTimeout: -2,
  /** Reputation at which the certificate unlocks. */
  certificateAt: 90,
} as const;

/**
 * What customers are willing to pay.
 *
 * You set a price list; each customer arrives with a private ceiling for their
 * basket and buys on their own if your price is at or under it. These numbers
 * decide how much headroom there is above the reference price in `data/items`.
 */
export const PRICING = {
  /**
   * Willingness-to-pay multiplier at reputation 0 / 100 respectively.
   *
   * Customer throughput, not production, is the real constraint: roughly a
   * dozen customers turn up in a long session, so a farm cannot sell its way
   * out of trouble on volume. There has to be genuine headroom above the
   * reference price for the pricing lever to be worth pulling.
   */
  willingnessAtMinRep: 0.9,
  willingnessAtMaxRep: 1.7,
  /** Random per-customer wobble, so the ceiling is never exactly predictable. */
  willingnessJitter: 0.12,
  /** Prices are clamped to this multiple of the reference price. */
  minPriceMultiple: 0.1,
  maxPriceMultiple: 10,
  /** Most lost sales kept in the rolling log. */
  maxLostSales: 20,
} as const;

/** Starting conditions for a brand-new farm. */
export const STARTING = {
  gold: 500,
  seeds: { radish_seed: 4, tomato_seed: 2 } as Record<string, number>,
  feed: 12,
  chickens: 1,
  cows: 0,
} as const;

/** Offline simulation cap: 2 game-hours. */
export const OFFLINE_CAP_MINUTES = 120;

/** How many events to retain in the rolling log. */
export const MAX_EVENTS = 60;
