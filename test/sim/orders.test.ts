import { describe, expect, it } from "vitest";
import { CROPS } from "../../src/data/crops.ts";
import {
  CROPS_BY_RETURN,
  DEFAULT_ORDERS,
  addItem,
  advance,
  chooseCrop,
  countItem,
  createFarm,
  goldPerMinute,
  isHarvestable,
  planStandingOrders,
  setPrices,
  type FarmState,
} from "../../src/sim/index.ts";
import { makeFarm } from "./helpers.ts";

/** A farm with Wren left in charge. */
function autonomous(seed = 1, overrides: Partial<FarmState["standingOrders"]> = {}): FarmState {
  const farm = createFarm(seed, 0);
  farm.standingOrders = { ...DEFAULT_ORDERS, enabled: true, ...overrides };
  return farm;
}

describe("standing orders: staying out of the way", () => {
  it("does nothing at all while switched off", () => {
    const farm = makeFarm();
    expect(farm.standingOrders.enabled).toBe(false);

    advance(farm, 300);
    expect(farm.wren.queue).toHaveLength(0);
    expect(farm.wren.current).toBeNull();
    expect(farm.plots.every((p) => !p.tilled && p.crop === null)).toBe(true);
  });

  it("never overrides work you assigned by hand", () => {
    const farm = autonomous();
    farm.wren.queue.push({ id: "manual", type: "till", target: "plot_12" });

    advance(farm, 1);
    // Her own plan may follow, but the hand-assigned job is still first.
    expect(farm.wren.current?.task.id ?? farm.wren.queue[0]?.id).toBe("manual");
  });

  it("plans nothing when there is nothing worth doing", () => {
    const farm = autonomous(1, { plant: "none", buySupplies: false });
    farm.inventory = {};
    farm.animals = [];
    expect(planStandingOrders(farm)).toHaveLength(0);
  });
});

describe("standing orders: priorities", () => {
  it("harvests before anything else", () => {
    const farm = autonomous();
    const plot = farm.plots[0];
    if (!plot) throw new Error("no plot");
    plot.crop = "radish";
    plot.tilled = false;
    plot.progress = CROPS.radish.growMinutes;

    expect(planStandingOrders(farm)[0]).toMatchObject({ type: "harvest", target: "plot_1" });
  });

  it("collects produce waiting with the animals", () => {
    const farm = autonomous();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.pending = 3;

    const plan = planStandingOrders(farm);
    expect(plan.some((t) => t.type === "collect")).toBe(true);
  });

  it("carries goods out to the stand", () => {
    const farm = autonomous();
    addItem(farm.inventory, "tomato", 4);
    expect(planStandingOrders(farm).some((t) => t.type === "restock")).toBe(true);
  });

  it("leaves the stand alone when told to", () => {
    const farm = autonomous(1, { keepStandStocked: false });
    addItem(farm.inventory, "tomato", 4);
    expect(planStandingOrders(farm).some((t) => t.type === "restock")).toBe(false);
  });

  it("feeds hungry animals", () => {
    const farm = autonomous();
    expect(planStandingOrders(farm).some((t) => t.type === "feed")).toBe(true);
  });

  it("waters a stalled crop", () => {
    const farm = autonomous();
    const plot = farm.plots[0];
    if (!plot) throw new Error("no plot");
    plot.crop = "corn";
    plot.tilled = false;
    plot.moisture = 0;

    expect(planStandingOrders(farm).some((t) => t.type === "water")).toBe(true);
  });

  it("sows a tilled bed", () => {
    const farm = autonomous();
    const plot = farm.plots[0];
    if (!plot) throw new Error("no plot");
    plot.tilled = true;

    expect(planStandingOrders(farm).some((t) => t.type === "plant")).toBe(true);
  });

  it("breaks new ground once there is seed for it", () => {
    const farm = autonomous();
    expect(planStandingOrders(farm).some((t) => t.type === "till")).toBe(true);
  });

  it("stops tilling when there is nothing to plant", () => {
    const farm = autonomous(1, { plant: "none" });
    expect(planStandingOrders(farm).some((t) => t.type === "till")).toBe(false);
  });

  it("makes a fuss of a miserable animal", () => {
    const farm = autonomous();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.mood = 0;
    chicken.fedUntil = 99999;

    expect(planStandingOrders(farm).some((t) => t.type === "pet")).toBe(true);
  });

  it("keeps the batch short so the plan stays current", () => {
    const farm = autonomous();
    for (const plot of farm.plots) plot.tilled = true;
    expect(planStandingOrders(farm).length).toBeLessThanOrEqual(6);
  });
});

describe("standing orders: spending", () => {
  it("respects the reserve", () => {
    const farm = autonomous(1, { reserve: 500 });
    farm.gold = 500;
    farm.inventory = {};

    // Every purchase would dip below the reserve, so nothing is bought.
    planStandingOrders(farm);
    expect(farm.gold).toBe(500);
  });

  it("buys seed when it is allowed to", () => {
    const farm = autonomous(1, { reserve: 0 });
    farm.gold = 400;
    farm.inventory = {};
    for (const plot of farm.plots) plot.tilled = true;

    planStandingOrders(farm);
    expect(farm.gold).toBeLessThan(400);
  });

  it("buys nothing at all when spending is off", () => {
    const farm = autonomous(1, { buySupplies: false });
    farm.gold = 1000;
    farm.inventory = {};

    planStandingOrders(farm);
    expect(farm.gold).toBe(1000);
  });

  it("plants the crop it is told to", () => {
    const farm = autonomous(1, { plant: "pumpkin", reserve: 0 });
    farm.gold = 1000;
    expect(chooseCrop(farm, farm.standingOrders)).toBe("pumpkin");
  });

  it("prefers seed already in the barn over buying more", () => {
    const farm = autonomous(1, { plant: "auto" });
    farm.inventory = { radish_seed: 3 };
    const before = farm.gold;

    expect(chooseCrop(farm, farm.standingOrders)).toBe("radish");
    expect(farm.gold).toBe(before);
  });

  it("ranks crops by return, not by sticker price", () => {
    // The pumpkin is the priciest crop and among the worst per minute; an
    // auto-planting farmhand must not be fooled by the price tag.
    expect(CROPS_BY_RETURN[0]).not.toBe("pumpkin");
    expect(goldPerMinute("strawberry")).toBeGreaterThan(goldPerMinute("pumpkin"));
  });

  it("reaches for a fast crop while the purse is thin", () => {
    const farm = autonomous(1, { plant: "auto", reserve: 0 });
    farm.gold = 60;
    farm.inventory = {};

    // Cash flow matters more than margin when there is no income yet.
    const crop = chooseCrop(farm, farm.standingOrders);
    expect(crop).not.toBeNull();
    expect(CROPS[crop as "radish"].growMinutes).toBeLessThanOrEqual(CROPS.tomato.growMinutes);
  });
});

describe("standing orders: a farm that runs itself", () => {
  /**
   * The point of the whole feature: switch it on, walk away, and come back to a
   * farm that has grown rather than one that has stalled.
   */
  it("turns a profit unattended", () => {
    for (const seed of [1, 42, 777]) {
      const farm = autonomous(seed, { reserve: 100 });
      const startGold = farm.gold;

      advance(farm, 1200);

      expect(farm.gold, `seed ${seed}`).toBeGreaterThan(startGold);
      expect(farm.gold, `seed ${seed} runaway`).toBeLessThan(startGold * 8);
    }
  });

  it("keeps the field working rather than letting it sit idle", () => {
    const farm = autonomous(9, { reserve: 100 });
    advance(farm, 800);

    const working = farm.plots.filter((p) => p.crop !== null || p.tilled).length;
    expect(working).toBeGreaterThan(4);
  });

  it("gets goods onto the stand without being asked", () => {
    const farm = autonomous(3, { reserve: 100 });
    advance(farm, 900);
    expect(farm.events.some((e) => e.text.includes("restocked the stand"))).toBe(true);
  });

  it("keeps the animals fed and producing", () => {
    const farm = autonomous(11, { reserve: 100 });
    advance(farm, 900);

    expect(farm.events.some((e) => e.text.includes("fed"))).toBe(true);
    const chicken = farm.animals[0];
    expect(chicken?.mood).toBeGreaterThan(0);
  });

  it("brings customers back to a farm that had gone quiet", () => {
    const farm = autonomous(5, { reserve: 100 });
    // Starts with nothing sellable at all, which is what stops arrivals.
    expect(countItem(farm.stand, "radish")).toBe(0);

    advance(farm, 1200);
    expect(farm.events.some((e) => e.text.includes("arrived at the stand"))).toBe(true);
  });

  it("never spends below the reserve, however long it runs", () => {
    const farm = autonomous(13, { reserve: 300 });
    farm.gold = 900;

    let low = farm.gold;
    for (let i = 0; i < 1500; i++) {
      advance(farm, 1);
      low = Math.min(low, farm.gold);
    }
    // Income can take it lower only by spending, and spending honours the floor.
    expect(low).toBeGreaterThanOrEqual(300 - CROPS.pumpkin.seedCost);
  });

  it("still sells at whatever price you set", () => {
    const farm = autonomous(21, { reserve: 100 });
    setPrices(farm, { radish: 3 });
    advance(farm, 1200);

    // Pricing stays the player's lever even when Wren runs everything else.
    expect(farm.prices["radish"]).toBe(3);
  });

  it("leaves nothing ripe rotting in the field", () => {
    const farm = autonomous(31, { reserve: 100 });
    advance(farm, 1200);

    const ripe = farm.plots.filter(isHarvestable).length;
    // She may be mid-round, but the field should not be full of unpicked crops.
    expect(ripe).toBeLessThanOrEqual(3);
  });
});
