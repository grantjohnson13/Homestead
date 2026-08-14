import { describe, expect, it } from "vitest";
import { ANCHORS, WREN_HOME, plotTile } from "../../src/data/map.ts";
import { STAMINA, WATER_CAN_CAPACITY, advance, countItem } from "../../src/sim/index.ts";
import { assign, assignOrThrow, eventText, isIdle, makeFarm, plant, plotOf } from "./helpers.ts";
import { CROPS } from "../../src/data/crops.ts";

/** Advances until Wren's queue empties, up to a tick budget. */
function runUntilIdle(state: ReturnType<typeof makeFarm>, maxTicks = 400): number {
  let ticks = 0;
  while (!isIdle(state) && ticks < maxTicks) {
    advance(state, 1);
    ticks += 1;
  }
  return ticks;
}

describe("Wren: task execution", () => {
  it("walks to a plot and tills it", () => {
    const farm = makeFarm();
    assignOrThrow(farm, [{ type: "till", target: "plot_1" }]);
    runUntilIdle(farm);

    const tile = plotTile("plot_1");
    expect(plotOf(farm, "plot_1").tilled).toBe(true);
    expect(farm.wren.x).toBe(tile?.x);
    expect(farm.wren.y).toBe(tile?.y);
  });

  it("works the queue in FIFO order", () => {
    const farm = makeFarm();
    assignOrThrow(farm, [
      { type: "till", target: "plot_1" },
      { type: "till", target: "plot_2" },
    ]);

    // plot_1 must be tilled before plot_2 starts.
    let sawFirstOnly = false;
    for (let i = 0; i < 400 && !isIdle(farm); i++) {
      advance(farm, 1);
      if (plotOf(farm, "plot_1").tilled && !plotOf(farm, "plot_2").tilled) sawFirstOnly = true;
    }
    expect(sawFirstOnly).toBe(true);
    expect(plotOf(farm, "plot_2").tilled).toBe(true);
  });

  it("consumes a seed when planting", () => {
    const farm = makeFarm();
    const before = countItem(farm.inventory, "radish_seed");
    assignOrThrow(farm, [
      { type: "till", target: "plot_1" },
      { type: "plant", target: "plot_1", crop: "radish" },
    ]);
    runUntilIdle(farm);

    expect(plotOf(farm, "plot_1").crop).toBe("radish");
    expect(countItem(farm.inventory, "radish_seed")).toBe(before - 1);
  });

  it("puts harvested produce into barn storage", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "radish", CROPS.radish.growMinutes);
    assignOrThrow(farm, [{ type: "harvest", target: "plot_1" }]);
    runUntilIdle(farm);

    expect(countItem(farm.inventory, "radish")).toBeGreaterThanOrEqual(1);
    expect(plotOf(farm, "plot_1").crop).toBeNull();
  });

  it("leaves an unripe crop alone and says so", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "pumpkin", 10);
    assignOrThrow(farm, [{ type: "harvest", target: "plot_1" }]);
    runUntilIdle(farm);

    expect(plotOf(farm, "plot_1").crop).toBe("pumpkin");
    expect(eventText(farm)).toContain("isn't ready yet");
  });

  it("faces the direction it is walking", () => {
    const farm = makeFarm();
    assignOrThrow(farm, [{ type: "till", target: "plot_12" }]);
    advance(farm, 3);
    expect(["up", "down", "left", "right"]).toContain(farm.wren.facing);
  });

  it("skips a task that has become impossible", () => {
    const farm = makeFarm();
    assignOrThrow(farm, [{ type: "till", target: "plot_1" }]);
    // Something else plants it before she arrives.
    plant(farm, "plot_1", "corn");
    runUntilIdle(farm);
    expect(plotOf(farm, "plot_1").crop).toBe("corn");
  });

  it("drifts home when the queue is empty", () => {
    const farm = makeFarm();
    assignOrThrow(farm, [{ type: "till", target: "plot_12" }]);
    runUntilIdle(farm);
    advance(farm, 60);
    expect(farm.wren.x).toBe(WREN_HOME.x);
    expect(farm.wren.y).toBe(WREN_HOME.y);
  });
});

describe("Wren: the watering can", () => {
  it("waters a plot and spends a charge", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "corn");
    const before = farm.wren.waterCharges;

    assignOrThrow(farm, [{ type: "water", target: "plot_1" }]);
    runUntilIdle(farm);

    expect(plotOf(farm, "plot_1").moisture).toBeGreaterThan(0);
    expect(farm.wren.waterCharges).toBe(before - 1);
  });

  it("visits the well once the can runs dry", () => {
    const farm = makeFarm();
    for (let i = 1; i <= WATER_CAN_CAPACITY + 1; i++) plant(farm, `plot_${i}`, "corn");
    farm.wren.waterCharges = 1;

    assignOrThrow(farm, [
      { type: "water", target: "plot_1" },
      { type: "water", target: "plot_2" },
    ]);

    let visitedWell = false;
    for (let i = 0; i < 400 && !isIdle(farm); i++) {
      advance(farm, 1);
      if (farm.wren.x === ANCHORS.well.x && farm.wren.y === ANCHORS.well.y) visitedWell = true;
    }

    expect(visitedWell).toBe(true);
    expect(farm.wren.waterCharges).toBe(WATER_CAN_CAPACITY - 1);
    expect(plotOf(farm, "plot_2").moisture).toBeGreaterThan(0);
  });
});

describe("Wren: stamina", () => {
  it("drains while working", () => {
    const farm = makeFarm();
    assignOrThrow(farm, [{ type: "till", target: "plot_1" }]);
    runUntilIdle(farm);
    expect(farm.wren.stamina).toBeLessThan(STAMINA.max);
  });

  it("recovers while idling at the farmhouse", () => {
    const farm = makeFarm();
    farm.wren.stamina = 40;
    farm.wren.x = WREN_HOME.x;
    farm.wren.y = WREN_HOME.y;
    advance(farm, 10);
    expect(farm.wren.stamina).toBeGreaterThan(40);
  });

  it("refuses new work once exhausted, and says so in Wren's voice", () => {
    const farm = makeFarm();
    farm.wren.stamina = STAMINA.refuseBelow + 1;
    assignOrThrow(farm, [
      { type: "till", target: "plot_1" },
      { type: "till", target: "plot_2" },
      { type: "till", target: "plot_3" },
    ]);

    // Watch for the moment she gives out: the flag must latch while work is
    // still queued, so the remaining tasks are deferred rather than dropped.
    let exhaustedWithWorkPending = false;
    for (let i = 0; i < 60; i++) {
      advance(farm, 1);
      if (farm.wren.exhausted && farm.wren.queue.length > 0) exhaustedWithWorkPending = true;
    }

    expect(exhaustedWithWorkPending).toBe(true);
    expect(eventText(farm)).toContain("worn out");
  });

  it("stays exhausted until rested back to the resume threshold", () => {
    const farm = makeFarm();
    farm.wren.stamina = 1;
    farm.wren.exhausted = true;
    farm.wren.x = WREN_HOME.x;
    farm.wren.y = WREN_HOME.y;

    advance(farm, 3);
    expect(farm.wren.exhausted).toBe(true); // not yet recovered

    advance(farm, 60);
    expect(farm.wren.stamina).toBeGreaterThanOrEqual(STAMINA.resumeAt);
    expect(farm.wren.exhausted).toBe(false);
  });

  it("picks the queue back up after resting", () => {
    const farm = makeFarm();
    farm.wren.stamina = STAMINA.refuseBelow + 1;
    assignOrThrow(farm, [
      { type: "till", target: "plot_1" },
      { type: "till", target: "plot_2" },
    ]);

    advance(farm, 600);
    expect(plotOf(farm, "plot_1").tilled).toBe(true);
    expect(plotOf(farm, "plot_2").tilled).toBe(true);
  });

  it("never drops below zero", () => {
    const farm = makeFarm();
    farm.wren.stamina = 0.5;
    assignOrThrow(farm, [{ type: "till", target: "plot_1" }]);
    advance(farm, 50);
    expect(farm.wren.stamina).toBeGreaterThanOrEqual(0);
  });
});

describe("Wren: the farm stand", () => {
  it("carries goods from the barn to the stand", () => {
    const farm = makeFarm();
    farm.inventory["tomato"] = 5;

    assignOrThrow(farm, [{ type: "restock", target: "tomato" }]);
    runUntilIdle(farm);

    expect(countItem(farm.stand, "tomato")).toBe(5);
    expect(countItem(farm.inventory, "tomato")).toBe(0);
  });

  it("respects a restock quantity", () => {
    const farm = makeFarm();
    farm.inventory["egg"] = 10;

    assignOrThrow(farm, [{ type: "restock", target: "egg", qty: 3 }]);
    runUntilIdle(farm);

    expect(countItem(farm.stand, "egg")).toBe(3);
    expect(countItem(farm.inventory, "egg")).toBe(7);
  });

  it("carries a mixed load when restocking everything", () => {
    const farm = makeFarm();
    farm.inventory["tomato"] = 2;
    farm.inventory["egg"] = 2;

    assignOrThrow(farm, [{ type: "restock", target: "all" }]);
    runUntilIdle(farm);

    expect(countItem(farm.stand, "tomato")).toBe(2);
    expect(countItem(farm.stand, "egg")).toBe(2);
  });

  it("copes with an empty barn", () => {
    const farm = makeFarm();
    assignOrThrow(farm, [{ type: "restock", target: "all" }]);
    runUntilIdle(farm);
    expect(eventText(farm)).toContain("nothing in the barn");
  });
});

describe("assign_tasks validation", () => {
  it("accepts till-then-plant on the same plot by projecting the batch", () => {
    const farm = makeFarm();
    const verdicts = assign(farm, [
      { type: "till", target: "plot_1" },
      { type: "plant", target: "plot_1", crop: "radish" },
    ]);
    expect(verdicts.every((v) => v.accepted)).toBe(true);
  });

  it("rejects planting on untilled soil", () => {
    const farm = makeFarm();
    const [verdict] = assign(farm, [{ type: "plant", target: "plot_1", crop: "radish" }]);
    expect(verdict?.accepted).toBe(false);
    expect(verdict?.reason).toContain("tilled first");
  });

  it("rejects planting more seeds than are in the barn", () => {
    const farm = makeFarm();
    farm.inventory["radish_seed"] = 1;
    const verdicts = assign(farm, [
      { type: "till", target: "plot_1" },
      { type: "plant", target: "plot_1", crop: "radish" },
      { type: "till", target: "plot_2" },
      { type: "plant", target: "plot_2", crop: "radish" },
    ]);
    expect(verdicts[1]?.accepted).toBe(true);
    expect(verdicts[3]?.accepted).toBe(false);
    expect(verdicts[3]?.reason).toContain("No radish seeds left");
  });

  it("rejects watering bare soil", () => {
    const farm = makeFarm();
    const [verdict] = assign(farm, [{ type: "water", target: "plot_1" }]);
    expect(verdict?.accepted).toBe(false);
    expect(verdict?.reason).toContain("Nothing is planted");
  });

  it("rejects tilling a plot that already has a crop", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "corn");
    const [verdict] = assign(farm, [{ type: "till", target: "plot_1" }]);
    expect(verdict?.accepted).toBe(false);
    expect(verdict?.reason).toContain("still has a crop");
  });

  it("rejects feeding with insufficient feed and names the shortfall", () => {
    const farm = makeFarm();
    farm.inventory["feed"] = 0;
    const [verdict] = assign(farm, [{ type: "feed", target: "all_chickens" }]);
    expect(verdict?.accepted).toBe(false);
    expect(verdict?.reason).toContain("Not enough feed");
  });

  it("rejects unknown task types and lists the valid ones", () => {
    const farm = makeFarm();
    const [verdict] = assign(farm, [{ type: "juggle", target: "plot_1" }]);
    expect(verdict?.accepted).toBe(false);
    expect(verdict?.reason).toContain("Unknown task type");
  });

  it("rejects a nonexistent plot", () => {
    const farm = makeFarm();
    const [verdict] = assign(farm, [{ type: "till", target: "plot_99" }]);
    expect(verdict?.accepted).toBe(false);
  });

  it("accepts loose plot spellings", () => {
    const farm = makeFarm();
    const verdicts = assign(farm, [
      { type: "till", target: "plot 2" },
      { type: "till", target: "3" },
      { type: "till", target: "PLOT_4" },
    ]);
    expect(verdicts.every((v) => v.accepted)).toBe(true);
    expect(verdicts[0]?.task?.target).toBe("plot_2");
    expect(verdicts[1]?.task?.target).toBe("plot_3");
    expect(verdicts[2]?.task?.target).toBe("plot_4");
  });

  it("rejects a bad crop name for planting", () => {
    const farm = makeFarm();
    const verdicts = assign(farm, [
      { type: "till", target: "plot_1" },
      { type: "plant", target: "plot_1", crop: "kumquat" },
    ]);
    expect(verdicts[1]?.accepted).toBe(false);
    expect(verdicts[1]?.reason).toContain("needs a crop");
  });

  it("rejects feeding an animal that does not exist", () => {
    const farm = makeFarm();
    const [verdict] = assign(farm, [{ type: "feed", target: "Gerald" }]);
    expect(verdict?.accepted).toBe(false);
    expect(verdict?.reason).toContain("No animal called");
  });
});
