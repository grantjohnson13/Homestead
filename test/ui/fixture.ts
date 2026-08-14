/**
 * A realistic farm snapshot for UI tests, produced by actually running the
 * simulation rather than hand-writing JSON — so the shape can never drift from
 * what the tools really return.
 */

import {
  addAnimal,
  addItem,
  advance,
  createFarm,
  nextId,
  validateBatch,
  type FarmState,
  type TaskInput,
} from "../../src/sim/index.ts";
import { snapshot, type FarmSnapshot } from "../../src/tools/snapshot.ts";

function assign(state: FarmState, tasks: TaskInput[]): void {
  const verdicts = validateBatch(state, tasks, () => nextId(state, "task"));
  for (const verdict of verdicts) {
    if (verdict.accepted && verdict.task) state.wren.queue.push(verdict.task);
  }
}

export function fixtureFarm(): FarmState {
  const farm = createFarm(20260814, 0);

  farm.gold = 1240;
  farm.reputation = 78;
  addAnimal(farm, "chicken");
  addAnimal(farm, "cow");

  const plan: [string, string][] = [
    ["plot_1", "radish"],
    ["plot_2", "lettuce"],
    ["plot_3", "tomato"],
    ["plot_4", "corn"],
    ["plot_5", "strawberry"],
    ["plot_6", "pumpkin"],
  ];
  for (const [plotId, crop] of plan) {
    const plot = farm.plots.find((p) => p.id === plotId);
    if (!plot) continue;
    plot.crop = crop as never;
    plot.tilled = false;
    plot.moisture = 40;
  }
  const spare = farm.plots.find((p) => p.id === "plot_9");
  if (spare) spare.tilled = true;

  for (const animal of farm.animals) animal.fedUntil = 500;

  addItem(farm.stand, "radish", 4);
  addItem(farm.stand, "tomato", 5);
  addItem(farm.stand, "egg", 3);
  addItem(farm.inventory, "egg", 6);

  advance(farm, 70);

  assign(farm, [
    { type: "water", target: "plot_6" },
    { type: "harvest", target: "plot_1" },
    { type: "collect", target: "all_chickens" },
    { type: "restock", target: "all" },
  ]);
  advance(farm, 4);

  return farm;
}

export function fixtureState(): FarmSnapshot {
  return snapshot(fixtureFarm());
}
