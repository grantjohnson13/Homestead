/**
 * Three scripted players, used to check that the economy holds up under
 * genuinely different styles of play.
 *
 * Each is a policy function called once per tick: look at the farm, queue work
 * when idle, serve whoever is at the stand. They play through the same public
 * surface a real player would drive via tools, so a balance problem here is a
 * balance problem in the game.
 */

import { GOODS, GOOD_IDS } from "../../src/data/items.ts";
import {
  advance,
  buySupplies,
  countItem,
  createFarm,
  eventsSince,
  isHarvestable,
  nextId,
  setPrices,
  validateBatch,
  type FarmState,
  type TaskInput,
} from "../../src/sim/index.ts";

export interface PlayResult {
  name: string;
  gold: number;
  goldDelta: number;
  goldLow: number;
  reputation: number;
  sales: number;
  harvests: number;
  walkouts: number;
  timeouts: number;
  finalStamina: number;
}

export type Policy = (farm: FarmState, tick: number, ctx: PlayContext) => void;

export interface PlayContext {
  queue(tasks: TaskInput[]): void;
  idle(): boolean;
}

function makeContext(farm: FarmState): PlayContext {
  return {
    queue(tasks: TaskInput[]) {
      const verdicts = validateBatch(farm, tasks, () => nextId(farm, "task"));
      for (const verdict of verdicts) {
        if (verdict.accepted && verdict.task) farm.wren.queue.push(verdict.task);
      }
    },
    idle() {
      return farm.wren.queue.length === 0 && farm.wren.current === null;
    },
  };
}

export interface PlayOptions {
  /**
   * Asking price as a multiple of the market reference. 1 = price at the
   * reference; above 1 trades volume for margin.
   */
  markup?: number;
}

export function play(
  name: string,
  seed: number,
  ticks: number,
  policy: Policy,
  options: PlayOptions = {},
): PlayResult {
  const farm = createFarm(seed, 0);
  const ctx = makeContext(farm);
  const startGold = farm.gold;

  // Pricing is a standing decision, set once at the start of the day.
  if (options.markup && options.markup !== 1) {
    setPrices(
      farm,
      Object.fromEntries(
        GOOD_IDS.map((good) => [
          good,
          Math.round(GOODS[good].basePrice * (options.markup as number)),
        ]),
      ),
    );
  }

  let sales = 0;
  let harvests = 0;
  let walkouts = 0;
  let goldLow = farm.gold;

  for (let tick = 0; tick < ticks; tick++) {
    const eventsBefore = farm.eventsLogged;
    advance(farm, 1);
    goldLow = Math.min(goldLow, farm.gold);

    // Read outcomes from the event log. The stand sells itself now, so there is
    // no per-customer call left to count.
    const fresh = eventsSince(farm, eventsBefore);
    harvests += fresh.filter((e) => e.text.includes("harvested")).length;
    sales += fresh.filter((e) => e.text.startsWith("Sold ")).length;
    walkouts += fresh.filter((e) => e.text.includes("baulked at")).length;

    policy(farm, tick, ctx);
  }

  const timeouts = farm.events.filter((e) => e.text.includes("left unserved")).length;

  return {
    name,
    gold: farm.gold,
    goldDelta: farm.gold - startGold,
    goldLow,
    reputation: Math.round(farm.reputation),
    sales,
    harvests,
    walkouts,
    timeouts,
    finalStamina: Math.round(farm.wren.stamina),
  };
}

/* ------------------------------------------------------------- policies -- */

/**
 * Cautious: a few cheap beds, kept watered, sold at the asking price. The
 * floor — if this cannot turn a profit, the game is too harsh.
 */
export const cautiousPlayer: Policy = (farm, tick, ctx) => {
  if (tick === 0) {
    buySupplies(farm, "radish_seed", 4);
    ctx.queue([
      ...["plot_1", "plot_2", "plot_3", "plot_4"].map((target) => ({ type: "till", target })),
      ...["plot_1", "plot_2", "plot_3", "plot_4"].map((target) => ({
        type: "plant",
        target,
        crop: "radish",
      })),
      ...["plot_1", "plot_2", "plot_3", "plot_4"].map((target) => ({ type: "water", target })),
    ]);
    return;
  }
  if (!ctx.idle()) return;

  const work: TaskInput[] = [];
  for (const plot of farm.plots) {
    if (isHarvestable(plot)) work.push({ type: "harvest", target: plot.id });
    else if (plot.crop && plot.moisture <= 0) work.push({ type: "water", target: plot.id });
    else if (plot.tilled && !plot.crop && countItem(farm.inventory, "radish_seed") > 0) {
      work.push({ type: "plant", target: plot.id, crop: "radish" });
    }
  }
  if (countItem(farm.inventory, "radish_seed") < 2 && farm.gold > 60) {
    buySupplies(farm, "radish_seed", 4);
  }
  work.push({ type: "restock", target: "all" });
  if (work.length > 0) ctx.queue(work);
};

/**
 * Aggressive expander: pushes to the largest field one farmhand can actually
 * keep watered, fills it with high-value crops, and haggles above the asking
 * price. The ceiling — if this runs away, the economy is broken.
 *
 * It works to a priority order rather than sweeping the whole field, and keeps
 * batches short so it can re-plan. Queueing all twelve plots at once is not
 * ambition, it is overextension: crops dry out while Wren is still tilling, and
 * the stand starves.
 */
const AGGRESSIVE_PLOTS = 8;

export const aggressivePlayer: Policy = (farm, tick, ctx) => {
  if (tick === 0) {
    // Buy enough to start without spending down to nothing — the early game has
    // no income at all, so a thin reserve is how this strategy dies.
    buySupplies(farm, "tomato_seed", 4);
    ctx.queue(
      farm.plots.slice(0, AGGRESSIVE_PLOTS).map((plot) => ({ type: "till", target: plot.id })),
    );
    return;
  }
  if (!ctx.idle()) return;

  const field = farm.plots.slice(0, AGGRESSIVE_PLOTS);
  const work: TaskInput[] = [];

  // 1. Take what is ready — that is the money.
  for (const plot of field) {
    if (isHarvestable(plot)) work.push({ type: "harvest", target: plot.id });
  }
  // 2. Keep the stand stocked, or customers walk and reputation slides.
  work.push({ type: "restock", target: "all" });
  // 3. Rescue anything that has stalled.
  for (const plot of field) {
    if (plot.crop && plot.moisture <= 0) work.push({ type: "water", target: plot.id });
  }
  // 4. Only then expand.
  for (const plot of field) {
    if (plot.tilled && !plot.crop) {
      const crop = pickAffordableCrop(farm);
      if (crop) work.push({ type: "plant", target: plot.id, crop });
    } else if (!plot.tilled && !plot.crop) {
      work.push({ type: "till", target: plot.id });
    }
  }

  // Short batches so the plan stays current.
  if (work.length > 0) ctx.queue(work.slice(0, 8));
};

/**
 * Picks by gold-per-minute, not by sticker price.
 *
 * This ordering is the one an informed player gets from `get_almanac`, and it is
 * deliberately not the order you would guess: a pumpkin sells for 220g but ties
 * up a plot for 150 watered minutes, which is worse per minute than a tomato
 * that bears twice. The expensive-looking crop being a trap is good design, so
 * the balance test should model a player who reads the almanac rather than one
 * who buys the shiniest seed.
 */
function pickAffordableCrop(farm: FarmState): string | null {
  // Cash flow first. With no income at all, committing every bed to a 60-minute
  // crop means a very long stretch with an empty purse and an empty stand; a few
  // fast beds fund the slow ones.
  const needsCashFlow = farm.gold < 250;
  const order: [string, string, number][] = needsCashFlow
    ? [
        ["radish", "radish_seed", 10],
        ["tomato", "tomato_seed", 30],
      ]
    : [
        ["strawberry", "strawberry_seed", 60],
        ["tomato", "tomato_seed", 30],
        ["corn", "corn_seed", 40],
        ["radish", "radish_seed", 10],
      ];
  for (const [crop, seedId, cost] of order) {
    if (countItem(farm.inventory, seedId) > 0) return crop;
    // Keep a working reserve rather than spending down to nothing.
    if (farm.gold > cost * 2 + 80) {
      const bought = buySupplies(farm, seedId, 2);
      if (bought.ok) return crop;
    }
  }
  return null;
}

/**
 * Animal-focused: buys livestock, keeps them fed and happy, sells eggs and milk
 * with only a token vegetable patch.
 */
export const animalPlayer: Policy = (farm, tick, ctx) => {
  if (tick === 0) {
    // Two to start, not three: with only a dozen customers a session, a third
    // hen produces eggs nobody is left to buy.
    buySupplies(farm, "chicken", 2);
    buySupplies(farm, "feed", 20);
    ctx.queue([
      { type: "feed", target: "all_animals" },
      { type: "till", target: "plot_1" },
      { type: "plant", target: "plot_1", crop: "radish" },
      { type: "water", target: "plot_1" },
    ]);
    return;
  }
  if (!ctx.idle()) return;

  if (countItem(farm.inventory, "feed") < 8 && farm.gold > 80) {
    buySupplies(farm, "feed", 20);
  }
  // A cow once it is clearly affordable.
  if (farm.gold > 700 && farm.animals.filter((a) => a.kind === "cow").length === 0) {
    buySupplies(farm, "cow", 1);
  }

  const work: TaskInput[] = [];
  const hungry = farm.animals.some((a) => a.fedUntil <= farm.clock);
  if (hungry && countItem(farm.inventory, "feed") > 0) {
    work.push({ type: "feed", target: "all_animals" });
  }
  if (farm.animals.some((a) => a.pending > 0)) {
    work.push({ type: "collect", target: "all_animals" });
  }
  if (farm.animals.some((a) => a.mood < 45)) {
    work.push({ type: "pet", target: "all_animals" });
  }
  for (const plot of farm.plots) {
    if (isHarvestable(plot)) work.push({ type: "harvest", target: plot.id });
    else if (plot.crop && plot.moisture <= 0) work.push({ type: "water", target: plot.id });
  }
  work.push({ type: "restock", target: "all" });
  if (work.length > 0) ctx.queue(work);
};

export const PLAYERS: { name: string; policy: Policy; options?: PlayOptions }[] = [
  // Each archetype also prices differently, since that is now the main lever:
  // the cautious farm undercuts to keep goods moving, the expander charges a
  // premium, and the dairy prices its scarce eggs and milk high.
  { name: "cautious", policy: cautiousPlayer, options: { markup: 1.0 } },
  { name: "aggressive", policy: aggressivePlayer, options: { markup: 1.2 } },
  { name: "animal-focused", policy: animalPlayer, options: { markup: 1.15 } },
];
