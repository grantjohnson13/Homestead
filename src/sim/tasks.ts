/**
 * Turning player intent into work.
 *
 * Two jobs live here:
 *  1. `validateBatch` — checks a whole ordered batch *up front*, simulating the
 *     effects each task would have so that "till plot_1, then plant in plot_1"
 *     validates cleanly even though plot_1 is untilled right now.
 *  2. `compileLegs` — at the moment Wren starts a task, works out the walk-and-
 *     work legs it decomposes into (a watering trip may need a well stop first;
 *     a restock is barn-then-stand).
 */

import { ANIMALS, type AnimalKind } from "../data/animals.ts";
import { CROPS, isCropId, type CropId } from "../data/crops.ts";
import { FEED_ITEM_ID, cropForSeedId, isGoodId, seedIdFor, type GoodId } from "../data/items.ts";
import { ANCHORS, PLOT_IDS, WREN_HOME, plotTile } from "../data/map.ts";
import { TASK_WORK_TICKS } from "./constants.ts";
import { countItem } from "./farm.ts";
import type { FarmState, Leg, QueuedTask, TaskType } from "./types.ts";

export const TASK_TYPES: readonly TaskType[] = [
  "till",
  "plant",
  "water",
  "harvest",
  "feed",
  "collect",
  "restock",
  "pet",
  "idle",
];

const PLOT_TASKS: ReadonlySet<TaskType> = new Set<TaskType>(["till", "plant", "water", "harvest"]);

export const ANIMAL_GROUPS = ["all_chickens", "all_cows", "all_animals"] as const;
export type AnimalGroup = (typeof ANIMAL_GROUPS)[number];

export function isAnimalGroup(value: string): value is AnimalGroup {
  return (ANIMAL_GROUPS as readonly string[]).includes(value);
}

/** Which animal kinds a target refers to. */
export function kindsForTarget(target: string): AnimalKind[] {
  if (target === "all_chickens") return ["chicken"];
  if (target === "all_cows") return ["cow"];
  if (target === "all_animals") return ["chicken", "cow"];
  return [];
}

/* ------------------------------------------------------------ validation -- */

export interface TaskInput {
  type: string;
  target?: string;
  crop?: string;
  qty?: number;
}

export interface TaskVerdict {
  index: number;
  accepted: boolean;
  reason?: string;
  task?: QueuedTask;
}

/** A lightweight shadow of the parts of the farm a batch can change. */
interface Projection {
  plots: Map<string, { tilled: boolean; crop: CropId | null; harvestsLeft: number }>;
  seeds: Map<string, number>;
  feed: number;
  animalIds: Set<string>;
  animalNames: Map<string, string>;
  kindCounts: Record<AnimalKind, number>;
}

function project(state: FarmState): Projection {
  const plots = new Map<string, { tilled: boolean; crop: CropId | null; harvestsLeft: number }>();
  for (const plot of state.plots) {
    plots.set(plot.id, {
      tilled: plot.tilled,
      crop: plot.crop,
      harvestsLeft: plot.crop ? CROPS[plot.crop].harvests - plot.harvestsDone : 0,
    });
  }
  const seeds = new Map<string, number>();
  for (const [id, qty] of Object.entries(state.inventory)) {
    if (cropForSeedId(id) && id.endsWith("_seed")) seeds.set(id, qty);
  }
  const kindCounts: Record<AnimalKind, number> = { chicken: 0, cow: 0 };
  const animalNames = new Map<string, string>();
  for (const animal of state.animals) {
    kindCounts[animal.kind] += 1;
    animalNames.set(animal.name.toLowerCase(), animal.id);
  }
  return {
    plots,
    seeds,
    feed: countItem(state.inventory, FEED_ITEM_ID),
    animalIds: new Set(state.animals.map((a) => a.id)),
    animalNames,
    kindCounts,
  };
}

/**
 * Validates an ordered batch. Every task gets its own verdict so the caller can
 * report exactly what was rejected and why, and accepted tasks are returned
 * ready to enqueue.
 */
export function validateBatch(
  state: FarmState,
  inputs: readonly TaskInput[],
  makeId: () => string,
): TaskVerdict[] {
  const projection = project(state);
  const verdicts: TaskVerdict[] = [];

  inputs.forEach((input, index) => {
    verdicts.push(validateOne(projection, input, index, makeId));
  });

  return verdicts;
}

function reject(index: number, reason: string): TaskVerdict {
  return { index, accepted: false, reason };
}

function validateOne(
  projection: Projection,
  input: TaskInput,
  index: number,
  makeId: () => string,
): TaskVerdict {
  const type = input.type as TaskType;
  if (!TASK_TYPES.includes(type)) {
    return reject(
      index,
      `Unknown task type "${input.type}". Valid types: ${TASK_TYPES.join(", ")}.`,
    );
  }

  if (PLOT_TASKS.has(type)) {
    const target = normalizePlotId(input.target);
    if (!target) {
      return reject(
        index,
        `Task "${type}" needs a plot target like "plot_3" (the farm has ${PLOT_IDS.length} plots).`,
      );
    }
    const plot = projection.plots.get(target);
    if (!plot) return reject(index, `There is no plot called "${target}".`);

    switch (type) {
      case "till":
        if (plot.crop) {
          return reject(index, `${target} still has a crop growing — harvest it before tilling.`);
        }
        if (plot.tilled) return reject(index, `${target} is already tilled.`);
        plot.tilled = true;
        break;

      case "plant": {
        const cropId = input.crop;
        if (!cropId || !isCropId(cropId)) {
          return reject(
            index,
            `Task "plant" needs a crop, one of: ${Object.keys(CROPS).join(", ")}.`,
          );
        }
        if (plot.crop) return reject(index, `${target} already has ${plot.crop} growing in it.`);
        if (!plot.tilled) {
          return reject(index, `${target} must be tilled first — add a till task before this one.`);
        }
        const seedId = seedIdFor(cropId);
        const available = projection.seeds.get(seedId) ?? 0;
        if (available < 1) {
          return reject(
            index,
            `No ${cropId} seeds left (buy them with buy_supplies, ${CROPS[cropId].seedCost}g each).`,
          );
        }
        projection.seeds.set(seedId, available - 1);
        plot.crop = cropId;
        plot.tilled = false;
        plot.harvestsLeft = CROPS[cropId].harvests;
        break;
      }

      case "water":
        if (!plot.crop) {
          return reject(index, `Nothing is planted in ${target}, so there is nothing to water.`);
        }
        break;

      case "harvest":
        if (!plot.crop) return reject(index, `Nothing is planted in ${target} to harvest.`);
        plot.harvestsLeft -= 1;
        if (plot.harvestsLeft <= 0) {
          plot.crop = null;
          plot.tilled = true;
        }
        break;
    }

    return {
      index,
      accepted: true,
      task: { id: makeId(), type, target, ...(input.crop ? { crop: input.crop as CropId } : {}) },
    };
  }

  if (type === "feed" || type === "pet") {
    const target = input.target ?? "all_animals";
    const resolved = resolveAnimalTarget(projection, target);
    if (!resolved.ok) return reject(index, resolved.reason);
    if (resolved.count === 0) {
      return reject(index, `There are no animals matching "${target}" on the farm yet.`);
    }
    if (type === "feed") {
      const needed = resolved.feedCost;
      if (projection.feed < needed) {
        return reject(
          index,
          `Not enough feed: that needs ${needed} but the barn has ${projection.feed}. Buy more with buy_supplies.`,
        );
      }
      projection.feed -= needed;
    }
    return { index, accepted: true, task: { id: makeId(), type, target } };
  }

  if (type === "collect") {
    const target = input.target ?? "all_animals";
    const resolved = resolveAnimalTarget(projection, target);
    if (!resolved.ok) return reject(index, resolved.reason);
    if (resolved.count === 0) {
      return reject(index, `There are no animals matching "${target}" to collect from.`);
    }
    return { index, accepted: true, task: { id: makeId(), type, target } };
  }

  if (type === "restock") {
    const target = input.target ?? "all";
    if (target !== "all" && !isGoodId(target)) {
      return reject(
        index,
        `"${target}" is not something the stand sells. Use a good like "tomato" or "egg", or "all".`,
      );
    }
    const qty = input.qty;
    if (qty !== undefined && (!Number.isFinite(qty) || qty <= 0)) {
      return reject(index, `restock qty must be a positive number, got ${String(qty)}.`);
    }
    return {
      index,
      accepted: true,
      task: { id: makeId(), type, target, ...(qty !== undefined ? { qty } : {}) },
    };
  }

  // idle
  return { index, accepted: true, task: { id: makeId(), type: "idle" } };
}

type AnimalResolution =
  | { ok: true; count: number; feedCost: number; kinds: AnimalKind[]; animalId?: string }
  | { ok: false; reason: string };

function resolveAnimalTarget(projection: Projection, target: string): AnimalResolution {
  if (isAnimalGroup(target)) {
    const kinds = kindsForTarget(target);
    let count = 0;
    let feedCost = 0;
    for (const kind of kinds) {
      const n = projection.kindCounts[kind];
      count += n;
      feedCost += n * ANIMALS[kind].feedPerServing;
    }
    return { ok: true, count, feedCost, kinds };
  }

  const byName = projection.animalNames.get(target.toLowerCase());
  const id = projection.animalIds.has(target) ? target : byName;
  if (!id) {
    return {
      ok: false,
      reason: `No animal called "${target}". Use an animal id, its name, or a group like "all_chickens".`,
    };
  }
  const kind: AnimalKind = id.startsWith("cow") ? "cow" : "chicken";
  return {
    ok: true,
    count: 1,
    feedCost: ANIMALS[kind].feedPerServing,
    kinds: [kind],
    animalId: id,
  };
}

/** Accepts "plot_3", "plot3", "3" and "Plot 3". */
export function normalizePlotId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  const match = /^(?:plot[ _-]?)?(\d{1,2})$/.exec(trimmed);
  if (!match) return undefined;
  const id = `plot_${Number(match[1])}`;
  return PLOT_IDS.includes(id) ? id : undefined;
}

/* --------------------------------------------------------------- compile -- */

/**
 * Works out the legs a task decomposes into, given the farm as it is right now.
 * Returns null when the task has become impossible since it was queued (the
 * caller drops it with an explanatory event).
 */
export function compileLegs(state: FarmState, task: QueuedTask): Leg[] | null {
  switch (task.type) {
    case "till":
    case "plant":
    case "harvest": {
      const tile = task.target ? plotTile(task.target) : undefined;
      if (!tile) return null;
      return [{ x: tile.x, y: tile.y, workTicks: TASK_WORK_TICKS[task.type], action: task.type }];
    }

    case "water": {
      const tile = task.target ? plotTile(task.target) : undefined;
      if (!tile) return null;
      const legs: Leg[] = [];
      if (state.wren.waterCharges <= 0) {
        legs.push({
          x: ANCHORS.well.x,
          y: ANCHORS.well.y,
          workTicks: 1,
          action: "refill",
        });
      }
      legs.push({ x: tile.x, y: tile.y, workTicks: TASK_WORK_TICKS.water, action: "water" });
      return legs;
    }

    case "feed":
    case "pet":
    case "collect": {
      const target = task.target ?? "all_animals";
      const kinds = resolveKinds(state, target);
      if (kinds.length === 0) return null;
      const action = task.type === "collect" ? "collect" : task.type;
      return kinds.map((kind) => {
        const anchor = kind === "chicken" ? ANCHORS.coop : ANCHORS.barn;
        return {
          x: anchor.x,
          y: anchor.y,
          workTicks: TASK_WORK_TICKS[task.type],
          action: action as Leg["action"],
          kind,
        };
      });
    }

    case "restock":
      return [
        {
          x: ANCHORS.barn.x,
          y: ANCHORS.barn.y,
          workTicks: TASK_WORK_TICKS.restock,
          action: "load",
        },
        {
          x: ANCHORS.stand.x,
          y: ANCHORS.stand.y,
          workTicks: TASK_WORK_TICKS.restock,
          action: "unload",
        },
      ];

    case "idle":
      return [{ x: WREN_HOME.x, y: WREN_HOME.y, workTicks: 1, action: "rest" }];
  }
}

/** Which buildings a feed/pet/collect task must visit, skipping empty ones. */
function resolveKinds(state: FarmState, target: string): AnimalKind[] {
  const present = (kind: AnimalKind) => state.animals.some((a) => a.kind === kind);
  if (isAnimalGroup(target)) {
    return kindsForTarget(target).filter(present);
  }
  const animal = state.animals.find(
    (a) => a.id === target || a.name.toLowerCase() === target.toLowerCase(),
  );
  return animal ? [animal.kind] : [];
}

/** The animals a feed/pet/collect leg applies to, once Wren has arrived. */
export function animalsForLeg(
  state: FarmState,
  task: QueuedTask,
  kind: AnimalKind,
): FarmState["animals"] {
  const target = task.target ?? "all_animals";
  if (isAnimalGroup(target)) {
    return state.animals.filter((a) => a.kind === kind);
  }
  return state.animals.filter(
    (a) => a.kind === kind && (a.id === target || a.name.toLowerCase() === target.toLowerCase()),
  );
}

/** Goods a restock task should carry, in a stable order. */
export function goodsForRestock(state: FarmState, task: QueuedTask): GoodId[] {
  const target = task.target ?? "all";
  if (target !== "all" && isGoodId(target)) return [target];
  return Object.keys(state.inventory).filter((id): id is GoodId => isGoodId(id));
}
