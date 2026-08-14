/**
 * Wren — walking, working, tiring, and resting.
 *
 * One tick is one game-minute. She either takes a step, or does a tick of work
 * on the leg she has arrived at. When a leg's work is finished its effect is
 * applied; when the last leg finishes, the task is done.
 */

import { ANIMALS } from "../data/animals.ts";
import { CROPS } from "../data/crops.ts";
import { FEED_ITEM_ID, describeGood, seedIdFor, type GoodId } from "../data/items.ts";
import { WREN_HOME, type Point } from "../data/map.ts";
import { WREN_LINES, type WrenContext } from "../data/wren-lines.ts";
import { STAMINA } from "./constants.ts";
import { harvestPlot, isHarvestable, waterPlot } from "./crops.ts";
import { addItem, countItem, findPlot, logEvent, takeItem } from "./farm.ts";
import { carryCapacity, moistureMultiplier, waterCanCapacity } from "./upgrades.ts";
import { feedAnimal, petAnimal } from "./livestock.ts";
import { findPath, facingFor } from "./pathfind.ts";
import { pick, randInt } from "./rng.ts";
import { animalsForLeg, compileLegs, goodsForRestock } from "./tasks.ts";
import type { ActiveTask, FarmState, Leg, QueuedTask } from "./types.ts";

/** How many units Wren can carry to the stand in one trip. */
export const CARRY_CAPACITY = 12;

export function wrenLine(state: FarmState, context: WrenContext): string {
  return pick(state, WREN_LINES[context]);
}

export function tickWren(state: FarmState): void {
  const wren = state.wren;

  if (wren.exhausted && wren.stamina >= STAMINA.resumeAt) {
    wren.exhausted = false;
    logEvent(state, "wren", `${wren.name} is rested and ready for work again.`);
  }

  if (!wren.current && !wren.exhausted && wren.queue.length > 0) {
    startNextTask(state);
  }

  if (wren.current) {
    advanceTask(state);
  } else {
    idleTick(state);
  }
}

/** Pulls tasks off the queue until one compiles into legs (or the queue empties). */
function startNextTask(state: FarmState): void {
  const wren = state.wren;
  while (wren.queue.length > 0) {
    const task = wren.queue.shift() as QueuedTask;
    const legs = compileLegs(state, task);
    if (!legs || legs.length === 0) {
      logEvent(
        state,
        "wren",
        `${wren.name} skipped a ${task.type} task — it no longer makes sense.`,
      );
      continue;
    }
    const first = legs[0] as Leg;
    const path = findPath({ x: wren.x, y: wren.y }, { x: first.x, y: first.y });
    if (path === null) {
      logEvent(state, "wren", `${wren.name} couldn't find a way to the ${task.type} site.`);
      continue;
    }
    wren.current = { task, legs, legIndex: 0, path, workDone: 0 };
    return;
  }
}

function advanceTask(state: FarmState): void {
  const wren = state.wren;
  const active = wren.current as ActiveTask;

  if (active.path.length > 0) {
    const step = active.path.shift() as Point;
    wren.facing = facingFor({ x: wren.x, y: wren.y }, step) ?? wren.facing;
    wren.x = step.x;
    wren.y = step.y;
    drain(state, STAMINA.walkDrainPerTick);
    return;
  }

  const leg = active.legs[active.legIndex] as Leg;
  active.workDone += 1;
  drain(state, leg.action === "rest" ? 0 : STAMINA.workDrainPerTick);

  if (active.workDone < leg.workTicks) return;

  applyLegEffect(state, active, leg);

  active.legIndex += 1;
  active.workDone = 0;

  if (active.legIndex >= active.legs.length) {
    wren.current = null;
    return;
  }

  const next = active.legs[active.legIndex] as Leg;
  const path = findPath({ x: wren.x, y: wren.y }, { x: next.x, y: next.y });
  if (path === null) {
    logEvent(state, "wren", `${wren.name} got stuck on the way to finish a ${active.task.type}.`);
    wren.current = null;
    return;
  }
  active.path = path;
}

function drain(state: FarmState, amount: number): void {
  const wren = state.wren;
  if (amount <= 0) return;
  wren.stamina = Math.max(0, wren.stamina - amount);
  if (wren.stamina <= STAMINA.refuseBelow && !wren.exhausted) {
    wren.exhausted = true;
    logEvent(state, "wren", `${wren.name} is worn out. ${wrenLine(state, "tired")}`);
  }
}

/** With nothing queued, Wren drifts home and gets her breath back. */
function idleTick(state: FarmState): void {
  const wren = state.wren;
  const atHome = wren.x === WREN_HOME.x && wren.y === WREN_HOME.y;

  if (atHome) {
    wren.stamina = Math.min(STAMINA.max, wren.stamina + STAMINA.restRecoverPerTick);
    return;
  }

  const path = findPath({ x: wren.x, y: wren.y }, WREN_HOME);
  if (path && path.length > 0) {
    const step = path[0] as Point;
    wren.facing = facingFor({ x: wren.x, y: wren.y }, step) ?? wren.facing;
    wren.x = step.x;
    wren.y = step.y;
  }
  wren.stamina = Math.min(STAMINA.max, wren.stamina + STAMINA.idleRecoverPerTick);
}

/* ----------------------------------------------------------- leg effects -- */

function applyLegEffect(state: FarmState, active: ActiveTask, leg: Leg): void {
  const wren = state.wren;
  const task = active.task;

  switch (leg.action) {
    case "till": {
      const plot = task.target ? findPlot(state, task.target) : undefined;
      if (!plot || plot.crop) return;
      plot.tilled = true;
      logEvent(state, "wren", `${wren.name} tilled ${plot.id}.`);
      return;
    }

    case "plant": {
      const plot = task.target ? findPlot(state, task.target) : undefined;
      const crop = task.crop;
      if (!plot || !crop || plot.crop || !plot.tilled) return;
      if (takeItem(state.inventory, seedIdFor(crop), 1) < 1) {
        logEvent(state, "wren", `${wren.name} reached for a ${crop} seed and found none.`);
        return;
      }
      plot.crop = crop;
      plot.tilled = false;
      plot.progress = 0;
      plot.moisture = 0;
      plot.harvestsDone = 0;
      logEvent(
        state,
        "crop",
        `${wren.name} planted ${CROPS[crop].name.toLowerCase()} in ${plot.id}.`,
      );
      return;
    }

    case "refill":
      wren.waterCharges = waterCanCapacity(state);
      return;

    case "water": {
      const plot = task.target ? findPlot(state, task.target) : undefined;
      if (!plot) return;
      if (wren.waterCharges <= 0) return;
      if (waterPlot(plot, moistureMultiplier(state))) {
        wren.waterCharges -= 1;
        logEvent(state, "crop", `${wren.name} watered ${plot.id}.`);
      } else {
        logEvent(state, "crop", `${plot.id} was already well watered.`);
      }
      return;
    }

    case "harvest": {
      const plot = task.target ? findPlot(state, task.target) : undefined;
      if (!plot || !plot.crop) return;
      const crop = CROPS[plot.crop];
      if (!isHarvestable(plot)) {
        logEvent(state, "crop", `${plot.id} isn't ready yet — ${wren.name} left it to grow.`);
        return;
      }
      const amount = randInt(state, crop.yield[0], crop.yield[1]);
      const cropId = plot.crop;
      const result = harvestPlot(plot, amount);
      if (!result) return;
      addItem(state.inventory, cropId, amount);
      logEvent(
        state,
        "crop",
        `${wren.name} harvested ${describeGood(cropId, amount)} from ${plot.id}${result.spent ? "" : " (it will bear again)"}.`,
      );
      return;
    }

    case "feed": {
      const kind = kindAtLeg(leg);
      const animals = animalsForLeg(state, task, kind);
      let fedCount = 0;
      for (const animal of animals) {
        const available = countItem(state.inventory, FEED_ITEM_ID);
        const used = feedAnimal(state, animal, available);
        if (used > 0) {
          takeItem(state.inventory, FEED_ITEM_ID, used);
          fedCount += 1;
        }
      }
      if (fedCount > 0) {
        logEvent(
          state,
          "animal",
          `${wren.name} fed ${fedCount} ${kind}${fedCount === 1 ? "" : "s"}.`,
        );
      } else if (animals.length > 0) {
        logEvent(state, "animal", `${wren.name} had no feed for the ${kind}s.`);
      }
      return;
    }

    case "pet": {
      const kind = kindAtLeg(leg);
      const animals = animalsForLeg(state, task, kind);
      for (const animal of animals) petAnimal(animal);
      if (animals.length > 0) {
        logEvent(
          state,
          "animal",
          `${wren.name} spent a minute with the ${kind}s. ${wrenLine(state, "animals")}`,
        );
      }
      return;
    }

    case "collect": {
      const kind = kindAtLeg(leg);
      const animals = animalsForLeg(state, task, kind);
      const good = ANIMALS[kind].produces;
      let total = 0;
      for (const animal of animals) {
        total += animal.pending;
        animal.pending = 0;
      }
      if (total > 0) {
        addItem(state.inventory, good, total);
        logEvent(state, "animal", `${wren.name} collected ${describeGood(good, total)}.`);
      } else {
        logEvent(state, "animal", `Nothing to collect from the ${kind}s yet.`);
      }
      return;
    }

    case "load": {
      wren.carrying = [];
      const goods = goodsForRestock(state, task);
      const capacity = carryCapacity(state);
      const limit = task.qty ?? capacity;
      let carried = 0;
      for (const good of goods) {
        if (carried >= Math.min(limit, capacity)) break;
        const room = Math.min(limit, capacity) - carried;
        const taken = takeItem(state.inventory, good, room);
        if (taken > 0) {
          wren.carrying.push({ good, qty: taken });
          carried += taken;
        }
      }
      if (carried === 0) {
        logEvent(
          state,
          "wren",
          `${wren.name} found nothing in the barn worth carrying to the stand.`,
        );
      }
      return;
    }

    case "unload": {
      let total = 0;
      for (const load of wren.carrying) {
        addItem(state.stand, load.good, load.qty);
        total += load.qty;
      }
      if (total > 0) {
        const summary = wren.carrying.map((l) => describeGood(l.good, l.qty)).join(", ");
        logEvent(state, "economy", `${wren.name} restocked the stand with ${summary}.`);
      }
      wren.carrying = [];
      return;
    }

    case "rest":
      wren.stamina = Math.min(STAMINA.max, wren.stamina + STAMINA.restRecoverPerTick);
      return;
  }
}

/** Feed/pet/collect legs carry the barnyard they belong to; default to the coop. */
function kindAtLeg(leg: Leg): "chicken" | "cow" {
  return leg.kind ?? "chicken";
}

/** Total units currently sitting on the stand. */
export function standTotal(state: FarmState): number {
  return Object.values(state.stand).reduce((sum, n) => sum + n, 0);
}

export type { GoodId };
