import { describe, expect, it } from "vitest";
import { GOODS } from "../../src/data/items.ts";
import { advance, createFarm, type FarmState } from "../../src/sim/index.ts";
import { migrate } from "../../src/tools/store.ts";

/**
 * Farms persist indefinitely, so a save can predate any field added since. These
 * are not hypothetical: a real farm saved before the pricing model threw the
 * first time a customer walked out, because `lostSales` did not exist yet.
 */
describe("migrating an older save", () => {
  /** A farm as an earlier build would have written it. */
  function legacyFarm(): FarmState {
    const farm = createFarm(99, 0);
    const legacy = farm as unknown as Record<string, unknown>;
    delete legacy["prices"];
    delete legacy["lostSales"];
    delete legacy["eventsLogged"];
    delete legacy["awayMinutes"];
    return farm;
  }

  it("fills in a missing price list from the market reference", () => {
    const farm = migrate(legacyFarm());
    expect(farm.prices["tomato"]).toBe(GOODS.tomato.basePrice);
    expect(farm.prices["egg"]).toBe(GOODS.egg.basePrice);
  });

  it("fills in a missing lost-sales log", () => {
    expect(migrate(legacyFarm()).lostSales).toEqual([]);
  });

  it("fills in counters added after the save was written", () => {
    const farm = migrate(legacyFarm());
    expect(typeof farm.eventsLogged).toBe("number");
    expect(farm.awayMinutes).toBe(0);
  });

  it("keeps a partially-set price list and tops up the rest", () => {
    const farm = legacyFarm();
    (farm as unknown as Record<string, unknown>)["prices"] = { tomato: 99 };

    migrate(farm);
    expect(farm.prices["tomato"]).toBe(99);
    expect(farm.prices["radish"]).toBe(GOODS.radish.basePrice);
  });

  it("gives a legacy customer a ceiling from their old offer", () => {
    const farm = legacyFarm();
    farm.customers.push({
      id: "customer_1",
      name: "Marta",
      portrait: 0,
      wants: [{ good: "egg", qty: 2 }],
      arrivedAt: 0,
      patience: 10,
      spot: { x: 7, y: 10 },
    } as unknown as FarmState["customers"][number]);
    (farm.customers[0] as unknown as Record<string, unknown>)["offer"] = 44;

    migrate(farm);
    expect(farm.customers[0]?.maxPrice).toBe(44);
  });

  it("leaves a migrated farm safe to simulate", () => {
    const farm = migrate(legacyFarm());
    farm.stand["tomato"] = 20;

    // This is the exact path that used to throw: a walkout writes to lostSales.
    expect(() => advance(farm, 600)).not.toThrow();
    expect(farm.gold).toBeGreaterThanOrEqual(0);
  });

  it("does not disturb a current save", () => {
    const farm = createFarm(7, 0);
    const before = JSON.stringify(farm);
    migrate(farm);
    expect(JSON.stringify(farm)).toBe(before);
  });
});
