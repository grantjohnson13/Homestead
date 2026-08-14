/**
 * Standing orders — Wren running the farm on her own.
 *
 * The player's job is meant to be the interesting one: what to grow, what to
 * charge, what to invest in. Deciding which of twelve plots needs water this
 * minute is not that, and it does not survive a conversational cadence: by the
 * time you have been told a bed is dry, said so, and had the task queued, the
 * crop has been stalled for a game-hour.
 *
 * So when her queue runs dry, Wren plans her own next few jobs from a fixed
 * priority order. Anything you assign by hand still comes first — standing
 * orders only ever fill idle time.
 */

import { CROPS, CROP_IDS, type CropId } from "../data/crops.ts";
import { GOOD_IDS } from "../data/items.ts";
import { seedIdFor } from "../data/items.ts";
import { isHarvestable } from "./crops.ts";
import { buySupplies } from "./economy.ts";
import { countItem } from "./farm.ts";
import { isFed } from "./livestock.ts";
import type { FarmState, StandingOrders, TaskInput } from "./types.ts";

/**
 * On by default.
 *
 * A farm where the farmhand stands still until told otherwise is not a game
 * about running a farm, it is a game about remembering to water things. Every
 * new farm starts with Wren working; the player's first decisions are what to
 * grow and what to charge, which are the interesting ones.
 */
export const DEFAULT_ORDERS: StandingOrders = {
  enabled: true,
  plant: "auto",
  buySupplies: true,
  reserve: 200,
  keepStandStocked: true,
};

/** How many jobs she lines up at once. Short, so the plan stays current. */
const BATCH = 6;

/** Below this mood an animal is worth a minute of fuss. */
const PET_BELOW = 35;

/**
 * Gold per watered minute, the same figure the almanac reports. Used to pick a
 * crop when the orders say "auto" — an informed farmhand plants for return, not
 * for sticker price.
 */
export function goldPerMinute(id: CropId): number {
  const crop = CROPS[id];
  const units = ((crop.yield[0] + crop.yield[1]) / 2) * crop.harvests;
  const net = units * crop.sellPrice - crop.seedCost;
  const minutes = crop.growMinutes * (1 + (crop.harvests - 1) * crop.regrowFraction);
  return net / minutes;
}

/** Crops ranked by return, best first. */
export const CROPS_BY_RETURN: readonly CropId[] = [...CROP_IDS].sort(
  (a, b) => goldPerMinute(b) - goldPerMinute(a),
);

/**
 * Which crop to sow next.
 *
 * Prefers seed already in the barn, then buys the best one affordable without
 * dipping into the reserve. Early on, when the purse is thin, the cheapest
 * fast crop keeps cash moving — a farm with no income cannot afford to tie
 * every bed up in a sixty-minute tomato.
 */
export function chooseCrop(state: FarmState, orders: StandingOrders): CropId | null {
  if (orders.plant === "none") return null;
  if (orders.plant !== "auto") {
    const wanted = orders.plant;
    if (countItem(state.inventory, seedIdFor(wanted)) > 0) return wanted;
    return orders.buySupplies && affords(state, orders, CROPS[wanted].seedCost) ? wanted : null;
  }

  const inStock = CROPS_BY_RETURN.find((id) => countItem(state.inventory, seedIdFor(id)) > 0);
  if (inStock) return inStock;
  if (!orders.buySupplies) return null;

  // Nothing in the barn: buy. Cash flow first while the purse is thin.
  const needsCashFlow = state.gold < orders.reserve + 200;
  const order = needsCashFlow
    ? [...CROPS_BY_RETURN].sort((a, b) => CROPS[a].growMinutes - CROPS[b].growMinutes)
    : CROPS_BY_RETURN;

  return order.find((id) => affords(state, orders, CROPS[id].seedCost)) ?? null;
}

function affords(state: FarmState, orders: StandingOrders, cost: number): boolean {
  return state.gold - cost >= orders.reserve;
}

/**
 * The next few jobs, in priority order.
 *
 * The ordering is the whole design: money first (harvest), then keeping the
 * stand able to take it (restock), then the things that stop production
 * (hungry animals, dry crops), and only then expansion.
 */
export function planStandingOrders(state: FarmState): TaskInput[] {
  const orders = state.standingOrders;
  if (!orders?.enabled) return [];

  const work: TaskInput[] = [];

  // 1. Take what is ripe. Nothing else earns anything.
  for (const plot of state.plots) {
    if (isHarvestable(plot)) work.push({ type: "harvest", target: plot.id });
  }

  // 2. Fetch produce that is sitting with the animals.
  if (state.animals.some((a) => a.kind === "chicken" && a.pending > 0)) {
    work.push({ type: "collect", target: "all_chickens" });
  }
  if (state.animals.some((a) => a.kind === "cow" && a.pending > 0)) {
    work.push({ type: "collect", target: "all_cows" });
  }

  // 3. Get goods out front, or customers stop coming at all.
  if (orders.keepStandStocked && barnHasGoods(state)) {
    work.push({ type: "restock", target: "all" });
  }

  // 4. Feed anything hungry; unfed animals simply stop producing.
  const hungry = state.animals.filter((a) => !isFed(a, state.clock));
  if (hungry.length > 0) {
    if (countItem(state.inventory, "feed") < hungry.length * 2 && orders.buySupplies) {
      buyFeed(state, orders);
    }
    if (countItem(state.inventory, "feed") > 0) {
      work.push({ type: "feed", target: "all_animals" });
    }
  }

  // 5. While she is at the coop anyway: a grumpy animal skips production, so
  //    cheering one up is maintenance, not sentiment. Kept next to feeding so
  //    it cannot be starved behind a field's worth of tilling.
  if (state.animals.some((a) => a.mood < PET_BELOW)) {
    work.push({ type: "pet", target: "all_animals" });
  }

  // 6. Rescue stalled crops.
  for (const plot of state.plots) {
    if (plot.crop && plot.moisture <= 0 && !isHarvestable(plot)) {
      work.push({ type: "water", target: plot.id });
    }
  }

  // 7. Sow empty beds, buying seed if allowed.
  for (const plot of state.plots) {
    if (plot.crop || !plot.tilled) continue;
    const crop = chooseCrop(state, orders);
    if (!crop) break;
    if (countItem(state.inventory, seedIdFor(crop)) === 0) {
      const bought = buySupplies(state, seedIdFor(crop), 2);
      if (!bought.ok) break;
    }
    work.push({ type: "plant", target: plot.id, crop });
  }

  // 8. Break new ground last, and only if there is a crop to put in it.
  if (chooseCrop(state, orders)) {
    for (const plot of state.plots) {
      if (!plot.crop && !plot.tilled) work.push({ type: "till", target: plot.id });
    }
  }

  return work.slice(0, BATCH);
}

function barnHasGoods(state: FarmState): boolean {
  return GOOD_IDS.some((id) => countItem(state.inventory, id) > 0);
}

function buyFeed(state: FarmState, orders: StandingOrders): void {
  // Bulk is cheaper, but only reach for it if the reserve allows.
  if (affords(state, orders, 35)) buySupplies(state, "feed", 10);
  else if (affords(state, orders, 4)) buySupplies(state, "feed", 1);
}
