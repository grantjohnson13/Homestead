import { describe, expect, it } from "vitest";
import { CROPS } from "../../src/data/crops.ts";
import { WREN_LINES, WREN_LINE_COUNT } from "../../src/data/wren-lines.ts";
import { CUSTOMER_PROFILES } from "../../src/data/customers.ts";
import { PLAYERS, play, type PlayResult } from "./players.ts";

/**
 * Balance: three genuinely different styles of play must all be viable, gold
 * must grow without running away, and no strategy may dominate.
 *
 * Run `node --experimental-strip-types scripts/balance-report.ts` to see the
 * numbers these assertions are drawn from.
 */

const SEEDS = [1, 7, 42, 1234, 99999];

function runAll(ticks: number): PlayResult[] {
  return PLAYERS.flatMap((player) =>
    SEEDS.map((seed) => play(player.name, seed, ticks, player.policy, player.options ?? {})),
  );
}

function averageFor(results: PlayResult[], name: string, pick: (r: PlayResult) => number): number {
  const matching = results.filter((r) => r.name === name);
  return matching.reduce((sum, r) => sum + pick(r), 0) / matching.length;
}

describe("balance: a short session (30 game-minutes)", () => {
  const results = runAll(30);

  it("never puts anyone into debt", () => {
    for (const result of results) {
      expect(result.goldLow, `${result.name} @ low`).toBeGreaterThanOrEqual(0);
      expect(result.gold, `${result.name} @ end`).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not punish reputation before the farm can produce anything", () => {
    // Customers stay away while there is nothing to sell, so an opening
    // investment phase must not cost reputation.
    for (const result of results) {
      expect(result.reputation, result.name).toBeGreaterThanOrEqual(45);
      expect(result.walkouts, result.name).toBe(0);
    }
  });

  it("leaves Wren able to keep working", () => {
    for (const result of results) {
      expect(result.finalStamina, result.name).toBeGreaterThan(0);
    }
  });
});

describe("balance: a full session (600 game-minutes)", () => {
  const results = runAll(600);

  it("makes every strategy profitable", () => {
    for (const player of PLAYERS) {
      const delta = averageFor(results, player.name, (r) => r.goldDelta);
      expect(delta, `${player.name} average profit`).toBeGreaterThan(0);
    }
  });

  it("keeps growth healthy rather than explosive", () => {
    for (const player of PLAYERS) {
      const gold = averageFor(results, player.name, (r) => r.gold);
      // Starting purse is 500. Growing, but nowhere near runaway.
      expect(gold, `${player.name} floor`).toBeGreaterThan(550);
      expect(gold, `${player.name} ceiling`).toBeLessThan(3000);
    }
  });

  it("lets no single strategy dominate", () => {
    const finals = PLAYERS.map((p) => averageFor(results, p.name, (r) => r.gold));
    const best = Math.max(...finals);
    const worst = Math.min(...finals);
    // Within a factor of two: styles differ in feel, not in whether they work.
    expect(best / worst).toBeLessThan(2);
  });

  it("rewards the expander for its slower, riskier start", () => {
    const aggressive = averageFor(results, "aggressive", (r) => r.gold);
    const cautious = averageFor(results, "cautious", (r) => r.gold);
    // It need not win, but taking on more must not be strictly worse.
    expect(aggressive).toBeGreaterThan(cautious * 0.8);
  });

  it("keeps everyone out of debt the whole way", () => {
    for (const result of results) {
      expect(result.goldLow, `${result.name} low water mark`).toBeGreaterThanOrEqual(0);
    }
  });

  it("lets reputation climb for players who serve their customers", () => {
    const animal = averageFor(results, "animal-focused", (r) => r.reputation);
    expect(animal).toBeGreaterThan(60);
  });

  it("actually sells things", () => {
    for (const player of PLAYERS) {
      expect(
        averageFor(results, player.name, (r) => r.sales),
        player.name,
      ).toBeGreaterThan(2);
    }
  });
});

describe("balance: the aggressive strategy's arc", () => {
  it("starts behind and catches up", () => {
    const early = runAll(120);
    const late = runAll(600);

    const earlyGap =
      averageFor(early, "cautious", (r) => r.gold) - averageFor(early, "aggressive", (r) => r.gold);
    const lateGap =
      averageFor(late, "cautious", (r) => r.gold) - averageFor(late, "aggressive", (r) => r.gold);

    // Investment costs early and pays later: the gap must close.
    expect(earlyGap).toBeGreaterThan(0);
    expect(lateGap).toBeLessThan(earlyGap);
  });
});

describe("crop economics", () => {
  /**
   * Gold per watered minute, accounting for regrowth on multi-harvest crops.
   * This is the number that decides whether a plot is worth its space.
   */
  function goldPerMinute(id: keyof typeof CROPS): number {
    const crop = CROPS[id];
    const units = ((crop.yield[0] + crop.yield[1]) / 2) * crop.harvests;
    const net = units * crop.sellPrice - crop.seedCost;
    const minutes = crop.growMinutes * (1 + (crop.harvests - 1) * crop.regrowFraction);
    return net / minutes;
  }

  it("keeps every crop worth planting", () => {
    for (const id of Object.keys(CROPS) as (keyof typeof CROPS)[]) {
      expect(goldPerMinute(id), id).toBeGreaterThan(0);
    }
  });

  it("keeps the crops within one order of magnitude of each other", () => {
    const rates = (Object.keys(CROPS) as (keyof typeof CROPS)[]).map(goldPerMinute);
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThan(6);
  });

  it("makes the priciest crop a trap rather than an obvious win", () => {
    // A pumpkin sells for 220g and looks like the best thing on the board, but
    // ties up a plot for 150 watered minutes. Rewarding players who read the
    // almanac instead of the price tag is the point.
    expect(CROPS.pumpkin.sellPrice).toBe(Math.max(...Object.values(CROPS).map((c) => c.sellPrice)));
    expect(goldPerMinute("pumpkin")).toBeLessThan(goldPerMinute("tomato"));
    expect(goldPerMinute("pumpkin")).toBeLessThan(goldPerMinute("strawberry"));
  });

  it("rewards multi-harvest crops for their upkeep", () => {
    expect(goldPerMinute("strawberry")).toBeGreaterThan(goldPerMinute("corn"));
    expect(goldPerMinute("tomato")).toBeGreaterThan(goldPerMinute("lettuce"));
  });

  it("keeps a radish the cheap, forgiving starter it is meant to be", () => {
    expect(CROPS.radish.seedCost).toBe(Math.min(...Object.values(CROPS).map((c) => c.seedCost)));
    expect(CROPS.radish.growMinutes).toBe(
      Math.min(...Object.values(CROPS).map((c) => c.growMinutes)),
    );
    expect(CROPS.radish.waterNeeds).toBe(1);
  });
});

describe("content", () => {
  it("gives Wren a full pool of lines", () => {
    expect(WREN_LINE_COUNT).toBeGreaterThanOrEqual(40);
  });

  it("covers every context with at least a few lines", () => {
    for (const [context, lines] of Object.entries(WREN_LINES)) {
      expect(lines.length, context).toBeGreaterThanOrEqual(3);
    }
  });

  it("has no duplicate Wren lines", () => {
    const all = Object.values(WREN_LINES).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("has at least ten named customers, each distinct", () => {
    expect(CUSTOMER_PROFILES.length).toBeGreaterThanOrEqual(10);
    const names = CUSTOMER_PROFILES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const portraits = CUSTOMER_PROFILES.map((c) => c.portrait);
    expect(new Set(portraits).size).toBe(portraits.length);
  });

  it("gives customers a real spread of buying personalities", () => {
    const generosity = CUSTOMER_PROFILES.map((c) => c.generosity);
    expect(Math.min(...generosity)).toBeLessThan(0.9);
    expect(Math.max(...generosity)).toBeGreaterThan(1.2);

    const sizes = new Set(CUSTOMER_PROFILES.map((c) => c.basketSize));
    expect(sizes.size).toBe(3);
  });

  it("gives every customer a blurb", () => {
    for (const customer of CUSTOMER_PROFILES) {
      expect(customer.blurb.length, customer.name).toBeGreaterThan(20);
    }
  });
});
