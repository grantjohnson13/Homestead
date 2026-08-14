import { describe, expect, it } from "vitest";
import { ANIMALS } from "../../src/data/animals.ts";
import { UPGRADES, UPGRADE_IDS } from "../../src/data/upgrades.ts";
import { CUSTOMERS } from "../../src/sim/constants.ts";
import {
  addItem,
  advance,
  animalCapacityLeft,
  arrivalIntervalMean,
  arrivalMultiplier,
  buySupplies,
  buyUpgrade,
  carryCapacity,
  housingFor,
  levelOf,
  moistureMultiplier,
  patienceMinutes,
  spawnCustomer,
  upgradeCatalogue,
  waterCanCapacity,
  willingnessBonus,
  willingnessMultiplier,
} from "../../src/sim/index.ts";
import { assignOrThrow, isIdle, makeFarm } from "./helpers.ts";

function runUntilIdle(state: ReturnType<typeof makeFarm>, maxTicks = 600): void {
  for (let i = 0; i < maxTicks && !isIdle(state); i++) advance(state, 1);
}

describe("buying an upgrade", () => {
  it("starts a farm with nothing invested", () => {
    const farm = makeFarm();
    for (const id of UPGRADE_IDS) expect(levelOf(farm, id)).toBe(0);
  });

  it("charges gold and records the level", () => {
    const farm = makeFarm();
    farm.gold = 1000;
    const outcome = buyUpgrade(farm, "watering_can");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.level).toBe(1);
    expect(outcome.cost).toBe(UPGRADES.watering_can.costs[0]);
    expect(farm.gold).toBe(1000 - (UPGRADES.watering_can.costs[0] as number));
    expect(levelOf(farm, "watering_can")).toBe(1);
  });

  it("costs more at the second level", () => {
    const farm = makeFarm();
    farm.gold = 10000;
    buyUpgrade(farm, "watering_can");
    const second = buyUpgrade(farm, "watering_can");

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected success");
    expect(second.cost).toBeGreaterThan(UPGRADES.watering_can.costs[0] as number);
  });

  it("refuses once fully upgraded", () => {
    const farm = makeFarm();
    farm.gold = 100000;
    for (const _ of UPGRADES.watering_can.costs) buyUpgrade(farm, "watering_can");

    const extra = buyUpgrade(farm, "watering_can");
    expect(extra.ok).toBe(false);
    if (extra.ok) throw new Error("expected refusal");
    expect(extra.reason).toContain("fully upgraded");
  });

  it("refuses when the tin is short, and says the price", () => {
    const farm = makeFarm();
    farm.gold = 10;
    const outcome = buyUpgrade(farm, "fine_stand");

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.reason).toContain("costs");
    expect(farm.gold).toBe(10);
  });

  it("rejects an unknown upgrade and lists the options", () => {
    const outcome = buyUpgrade(makeFarm(), "helicopter");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.reason).toContain("watering_can");
  });

  it("lists a catalogue with levels and next prices", () => {
    const farm = makeFarm();
    farm.gold = 10000;
    buyUpgrade(farm, "sprinklers");

    const catalogue = upgradeCatalogue(farm);
    expect(catalogue).toHaveLength(UPGRADE_IDS.length);

    const sprinklers = catalogue.find((u) => u.id === "sprinklers");
    expect(sprinklers?.level).toBe(1);
    expect(sprinklers?.owned).toBe(true);
    expect(sprinklers?.nextCost).toBe(UPGRADES.sprinklers.costs[1]);

    const untouched = catalogue.find((u) => u.id === "signboard");
    expect(untouched?.level).toBe(0);
    expect(untouched?.nextCost).toBe(UPGRADES.signboard.costs[0]);
  });

  it("reports null next cost when maxed", () => {
    const farm = makeFarm();
    farm.gold = 100000;
    for (const _ of UPGRADES.wheelbarrow.costs) buyUpgrade(farm, "wheelbarrow");

    const entry = upgradeCatalogue(farm).find((u) => u.id === "wheelbarrow");
    expect(entry?.nextCost).toBeNull();
    expect(entry?.level).toBe(entry?.maxLevel);
  });
});

describe("upgrades change the farm", () => {
  it("makes the watering can hold more", () => {
    const farm = makeFarm();
    const before = waterCanCapacity(farm);
    farm.gold = 1000;
    buyUpgrade(farm, "watering_can");
    expect(waterCanCapacity(farm)).toBeGreaterThan(before);
  });

  it("refills to the upgraded capacity in play", () => {
    const farm = makeFarm();
    farm.gold = 1000;
    buyUpgrade(farm, "watering_can");
    farm.wren.waterCharges = 0;

    for (let i = 1; i <= 3; i++) {
      const plot = farm.plots[i - 1];
      if (plot) {
        plot.crop = "corn";
        plot.tilled = false;
      }
    }
    assignOrThrow(farm, [{ type: "water", target: "plot_1" }]);
    runUntilIdle(farm);

    // Refilled to the bigger can, then spent one on plot_1.
    expect(farm.wren.waterCharges).toBe(waterCanCapacity(farm) - 1);
  });

  it("lets Wren carry more per restock trip", () => {
    const plain = makeFarm();
    const upgraded = makeFarm();
    upgraded.gold = 1000;
    buyUpgrade(upgraded, "wheelbarrow");

    expect(carryCapacity(upgraded)).toBeGreaterThan(carryCapacity(plain));

    for (const farm of [plain, upgraded]) {
      addItem(farm.inventory, "tomato", 40);
      assignOrThrow(farm, [{ type: "restock", target: "tomato" }]);
      runUntilIdle(farm);
    }

    expect(upgraded.stand["tomato"]).toBeGreaterThan(plain.stand["tomato"] as number);
  });

  it("makes waterings last longer with sprinklers", () => {
    const farm = makeFarm();
    expect(moistureMultiplier(farm)).toBe(1);
    farm.gold = 2000;
    buyUpgrade(farm, "sprinklers");
    expect(moistureMultiplier(farm)).toBeGreaterThan(1);
  });

  it("keeps a crop growing longer per watering with sprinklers", () => {
    const plain = makeFarm();
    const upgraded = makeFarm();
    upgraded.gold = 2000;
    buyUpgrade(upgraded, "sprinklers");

    for (const farm of [plain, upgraded]) {
      const plot = farm.plots[0];
      if (!plot) throw new Error("no plot");
      plot.crop = "corn";
      plot.tilled = false;
      assignOrThrow(farm, [{ type: "water", target: "plot_1" }]);
      runUntilIdle(farm);
      advance(farm, 40);
    }

    expect(upgraded.plots[0]?.progress).toBeGreaterThan(plain.plots[0]?.progress as number);
  });

  it("brings customers more often with a bigger stall", () => {
    const farm = makeFarm();
    expect(arrivalMultiplier(farm)).toBe(1);
    farm.gold = 2000;
    buyUpgrade(farm, "market_stall");

    expect(arrivalMultiplier(farm)).toBeLessThan(1);
    expect(arrivalIntervalMean(50, arrivalMultiplier(farm))).toBeLessThan(
      arrivalIntervalMean(50, 1),
    );
  });

  it("makes customers wait longer with a signboard", () => {
    const farm = makeFarm();
    expect(patienceMinutes(farm)).toBe(CUSTOMERS.patienceMinutes);
    farm.gold = 2000;
    buyUpgrade(farm, "signboard");
    expect(patienceMinutes(farm)).toBeGreaterThan(CUSTOMERS.patienceMinutes);
  });

  it("gives new arrivals the upgraded patience", () => {
    const farm = makeFarm();
    farm.gold = 2000;
    buyUpgrade(farm, "signboard");
    addItem(farm.stand, "tomato", 20);

    expect(spawnCustomer(farm).patience).toBe(patienceMinutes(farm));
  });

  it("raises what customers will pay with a handsome stand", () => {
    const farm = makeFarm();
    expect(willingnessBonus(farm)).toBe(1);
    farm.gold = 3000;
    buyUpgrade(farm, "fine_stand");

    expect(willingnessBonus(farm)).toBeGreaterThan(1);
    expect(willingnessMultiplier(50, willingnessBonus(farm))).toBeGreaterThan(
      willingnessMultiplier(50, 1),
    );
  });

  it("raises a real customer's ceiling with a handsome stand", () => {
    const plain = makeFarm(11);
    const upgraded = makeFarm(11);
    upgraded.gold = 3000;
    buyUpgrade(upgraded, "fine_stand");

    addItem(plain.stand, "tomato", 20);
    addItem(upgraded.stand, "tomato", 20);

    expect(spawnCustomer(upgraded).maxPrice).toBeGreaterThan(spawnCustomer(plain).maxPrice);
  });

  it("adds housing with the coop and barn extensions", () => {
    const farm = makeFarm();
    expect(housingFor(farm, "chicken")).toBe(ANIMALS.chicken.capacity);
    expect(housingFor(farm, "cow")).toBe(ANIMALS.cow.capacity);

    farm.gold = 5000;
    buyUpgrade(farm, "coop_extension");
    buyUpgrade(farm, "barn_extension");

    expect(housingFor(farm, "chicken")).toBeGreaterThan(ANIMALS.chicken.capacity);
    expect(housingFor(farm, "cow")).toBeGreaterThan(ANIMALS.cow.capacity);
  });

  it("lets you actually buy past the old animal cap", () => {
    const farm = makeFarm();
    farm.gold = 100000;
    // Fill the coop to its unupgraded limit.
    while (animalCapacityLeft(farm, "chicken") > 0) {
      buySupplies(farm, "chicken", 1);
    }
    expect(animalCapacityLeft(farm, "chicken")).toBe(0);

    buyUpgrade(farm, "coop_extension");
    expect(animalCapacityLeft(farm, "chicken")).toBeGreaterThan(0);
  });
});

describe("upgrade catalogue sanity", () => {
  it("gives every upgrade a name, effect, blurb and icon", () => {
    for (const id of UPGRADE_IDS) {
      const def = UPGRADES[id];
      expect(def.name.length, id).toBeGreaterThan(3);
      expect(def.effect.length, id).toBeGreaterThan(8);
      expect(def.blurb.length, id).toBeGreaterThan(15);
      expect(def.icon.length, id).toBeGreaterThan(2);
    }
  });

  it("makes every upgrade get more expensive as it levels", () => {
    for (const id of UPGRADE_IDS) {
      const costs = UPGRADES[id].costs;
      expect(costs.length, id).toBeGreaterThan(0);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i] as number, `${id} level ${i + 1}`).toBeGreaterThan(costs[i - 1] as number);
      }
    }
  });

  it("prices the stand upgrades as the serious investments they are", () => {
    // Customer throughput caps a farm's income, so the levers that raise it
    // should cost meaningfully more than the convenience ones.
    expect(UPGRADES.fine_stand.costs[0] as number).toBeGreaterThan(
      UPGRADES.watering_can.costs[0] as number,
    );
    expect(UPGRADES.market_stall.costs[0] as number).toBeGreaterThan(
      UPGRADES.signboard.costs[0] as number,
    );
  });

  it("keeps every first level affordable within a session", () => {
    // Starting gold is 500; nothing should be so dear it is unreachable.
    for (const id of UPGRADE_IDS) {
      expect(UPGRADES[id].costs[0] as number, id).toBeLessThan(700);
    }
  });
});
