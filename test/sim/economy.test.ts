import { describe, expect, it } from "vitest";
import { ANIMALS } from "../../src/data/animals.ts";
import {
  FEED_BULK_PRICE,
  FEED_BULK_SIZE,
  FEED_UNIT_PRICE,
  feedPrice,
} from "../../src/data/shop.ts";
import { CROPS } from "../../src/data/crops.ts";
import { STARTING } from "../../src/sim/constants.ts";
import { buySupplies, countItem, quote } from "../../src/sim/index.ts";
import { makeFarm } from "./helpers.ts";

describe("starting conditions", () => {
  it("matches the design spec", () => {
    const farm = makeFarm();
    expect(farm.gold).toBe(500);
    expect(countItem(farm.inventory, "radish_seed")).toBe(4);
    expect(countItem(farm.inventory, "tomato_seed")).toBe(2);
    expect(countItem(farm.inventory, "feed")).toBe(STARTING.feed);
    expect(farm.animals.filter((a) => a.kind === "chicken")).toHaveLength(1);
  });

  it("starts with twelve untilled plots", () => {
    const farm = makeFarm();
    expect(farm.plots).toHaveLength(12);
    expect(farm.plots.every((p) => !p.tilled && p.crop === null)).toBe(true);
  });

  it("starts with an empty stand", () => {
    expect(Object.keys(makeFarm().stand)).toHaveLength(0);
  });
});

describe("buying supplies", () => {
  it("buys seeds and deducts the cost", () => {
    const farm = makeFarm();
    const outcome = buySupplies(farm, "pumpkin_seed", 2);

    expect(outcome.ok).toBe(true);
    expect(farm.gold).toBe(500 - CROPS.pumpkin.seedCost * 2);
    expect(countItem(farm.inventory, "pumpkin_seed")).toBe(2);
  });

  it("buys a chicken and names it", () => {
    const farm = makeFarm();
    const outcome = buySupplies(farm, "chicken", 1);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.names?.[0]).toBeTypeOf("string");
    expect(farm.animals).toHaveLength(2);
    expect(farm.gold).toBe(500 - ANIMALS.chicken.cost);
  });

  it("refuses to overspend", () => {
    const farm = makeFarm();
    const outcome = buySupplies(farm, "cow", 2); // 800g on a 500g purse

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.reason).toContain("tin holds 500g");
    expect(farm.gold).toBe(500);
  });

  it("refuses to overfill the coop", () => {
    const farm = makeFarm();
    farm.gold = 100000;
    const outcome = buySupplies(farm, "chicken", ANIMALS.chicken.capacity);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.reason).toContain("Only room for");
  });

  it("fills the coop exactly to capacity", () => {
    const farm = makeFarm();
    farm.gold = 100000;
    const outcome = buySupplies(farm, "chicken", ANIMALS.chicken.capacity - 1);

    expect(outcome.ok).toBe(true);
    expect(farm.animals.filter((a) => a.kind === "chicken")).toHaveLength(ANIMALS.chicken.capacity);
    expect(buySupplies(farm, "chicken", 1).ok).toBe(false);
  });

  it("rejects unknown items", () => {
    const farm = makeFarm();
    const outcome = buySupplies(farm, "tractor", 1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.reason).toContain("doesn't stock");
  });

  it("rejects nonsense quantities", () => {
    const farm = makeFarm();
    expect(buySupplies(farm, "feed", 0).ok).toBe(false);
    expect(buySupplies(farm, "feed", -3).ok).toBe(false);
    expect(buySupplies(farm, "feed", 1.5).ok).toBe(false);
    expect(farm.gold).toBe(500);
  });

  it("discounts feed bought in bulk", () => {
    expect(feedPrice(FEED_BULK_SIZE)).toBe(FEED_BULK_PRICE);
    expect(feedPrice(FEED_BULK_SIZE)).toBeLessThan(FEED_UNIT_PRICE * FEED_BULK_SIZE);
    expect(feedPrice(FEED_BULK_SIZE + 3)).toBe(FEED_BULK_PRICE + 3 * FEED_UNIT_PRICE);
    expect(feedPrice(3)).toBe(3 * FEED_UNIT_PRICE);
  });

  it("quotes a price without charging for it", () => {
    const farm = makeFarm();
    expect(quote("radish_seed", 3)).toBe(CROPS.radish.seedCost * 3);
    expect(quote("nonsense", 1)).toBeNull();
    expect(farm.gold).toBe(500);
  });
});

describe("crop economics", () => {
  it("makes every crop profitable per seed", () => {
    for (const crop of Object.values(CROPS)) {
      const avgYield = ((crop.yield[0] + crop.yield[1]) / 2) * crop.harvests;
      const revenue = avgYield * crop.sellPrice;
      expect(revenue, `${crop.id} revenue`).toBeGreaterThan(crop.seedCost);
    }
  });

  it("makes slower crops pay better per seed than the fastest one", () => {
    const net = (id: keyof typeof CROPS) => {
      const c = CROPS[id];
      return ((c.yield[0] + c.yield[1]) / 2) * c.harvests * c.sellPrice - c.seedCost;
    };
    expect(net("pumpkin")).toBeGreaterThan(net("radish"));
    expect(net("tomato")).toBeGreaterThan(net("lettuce"));
  });
});
