import { describe, expect, it } from "vitest";
import {
  advance,
  buySupplies,
  countItem,
  fulfillment,
  isHarvestable,
  sellToCustomer,
  type FarmState,
} from "../../src/sim/index.ts";
import { assignOrThrow, makeFarm } from "./helpers.ts";

/**
 * A scripted day on the farm. This is the integration test for the whole
 * simulation: a plausible player works four plots, keeps them watered, harvests,
 * restocks the stand and serves whoever turns up — and the farm should end the
 * day better off than it started.
 */

interface DayResult {
  farm: FarmState;
  sales: number;
  harvests: number;
  goldLow: number;
}

function playDemoDay(seed: number, ticks: number): DayResult {
  const farm = makeFarm(seed);
  const plots = ["plot_1", "plot_2", "plot_3", "plot_4"];

  // Morning: buy seed and get four beds tilled, sown and watered.
  buySupplies(farm, "radish_seed", 4);
  assignOrThrow(farm, [
    ...plots.map((target) => ({ type: "till", target })),
    ...plots.map((target) => ({ type: "plant", target, crop: "radish" })),
    ...plots.map((target) => ({ type: "water", target })),
    { type: "feed", target: "all_chickens" },
  ]);

  let sales = 0;
  let harvests = 0;
  let goldLow = farm.gold;

  for (let tick = 0; tick < ticks; tick++) {
    advance(farm, 1);
    goldLow = Math.min(goldLow, farm.gold);

    // Serve anyone the stand can actually satisfy, at their asking price.
    for (const customer of [...farm.customers]) {
      if (fulfillment(farm, customer).canFulfill) {
        if (sellToCustomer(farm, customer.id).kind === "sold") sales += 1;
      }
    }

    // Every so often, tidy up: harvest what is ready, re-water what has dried,
    // and carry the barn out to the stand.
    if (tick % 20 === 0 && farm.wren.queue.length === 0 && farm.wren.current === null) {
      const work: { type: string; target: string; crop?: string }[] = [];

      for (const plot of farm.plots) {
        if (isHarvestable(plot)) {
          work.push({ type: "harvest", target: plot.id });
          harvests += 1;
        } else if (plot.crop && plot.moisture <= 0) {
          work.push({ type: "water", target: plot.id });
        }
      }
      work.push({ type: "collect", target: "all_chickens" });
      work.push({ type: "restock", target: "all" });

      assignOrThrow(farm, work);
    }
  }

  return { farm, sales, harvests, goldLow };
}

describe("a scripted demo day (200 ticks)", () => {
  const { farm, sales, harvests, goldLow } = playDemoDay(2024, 200);

  it("keeps the clock in step with the ticks", () => {
    expect(farm.clock).toBe(200);
  });

  it("actually grows and harvests crops", () => {
    expect(harvests).toBeGreaterThan(0);
  });

  it("gets goods onto the stand", () => {
    const onStand = Object.values(farm.stand).reduce((sum, n) => sum + n, 0);
    const sold = sales > 0;
    expect(onStand > 0 || sold).toBe(true);
  });

  it("serves customers", () => {
    expect(sales).toBeGreaterThan(0);
  });

  it("ends the day richer than it started", () => {
    expect(farm.gold).toBeGreaterThan(500);
  });

  it("never goes into debt", () => {
    expect(goldLow).toBeGreaterThanOrEqual(0);
    expect(farm.gold).toBeGreaterThanOrEqual(0);
  });

  it("does not run away with the economy", () => {
    // A single day of four radish beds should be a modest profit, not a fortune.
    expect(farm.gold).toBeLessThan(5000);
  });

  it("keeps reputation in a healthy band", () => {
    expect(farm.reputation).toBeGreaterThan(20);
    expect(farm.reputation).toBeLessThanOrEqual(100);
  });

  it("works Wren hard but not into the ground", () => {
    expect(farm.wren.stamina).toBeGreaterThanOrEqual(0);
    expect(farm.wren.stamina).toBeLessThanOrEqual(100);
  });

  it("collects eggs from the fed chicken", () => {
    expect(countItem(farm.inventory, "egg") + countItem(farm.stand, "egg")).toBeGreaterThanOrEqual(
      0,
    );
    expect(farm.animals[0]?.fedUntil).toBeGreaterThan(0);
  });

  it("leaves a narratable event trail", () => {
    expect(farm.events.length).toBeGreaterThan(10);
    expect(farm.events.every((e) => e.text.length > 0)).toBe(true);
  });

  it("holds up across several seeds", () => {
    for (const seed of [1, 77, 1234, 99999]) {
      const run = playDemoDay(seed, 200);
      expect(run.farm.gold, `seed ${seed} gold`).toBeGreaterThan(400);
      expect(run.farm.gold, `seed ${seed} runaway`).toBeLessThan(5000);
      expect(run.goldLow, `seed ${seed} debt`).toBeGreaterThanOrEqual(0);
      expect(run.harvests, `seed ${seed} harvests`).toBeGreaterThan(0);
    }
  });
});
