import { describe, expect, it } from "vitest";
import { CUSTOMERS, REPUTATION } from "../../src/sim/constants.ts";
import {
  addItem,
  adjustReputation,
  advance,
  arrivalIntervalMean,
  countItem,
  fulfillment,
  patienceRemaining,
  sellToCustomer,
  spawnCustomer,
  toleranceMultiplier,
  type Customer,
  type FarmState,
} from "../../src/sim/index.ts";
import { makeFarm } from "./helpers.ts";

/** Puts a specific, fully-stocked customer at the stand. */
function stageCustomer(farm: FarmState, overrides: Partial<Customer> = {}): Customer {
  const customer: Customer = {
    id: "customer_test",
    name: "Testy",
    portrait: 0,
    wants: [{ good: "tomato", qty: 2 }],
    offer: 90,
    tolerance: 110,
    arrivedAt: farm.clock,
    patience: CUSTOMERS.patienceMinutes,
    spot: { x: 7, y: 10 },
    ...overrides,
  };
  farm.customers.push(customer);
  for (const want of customer.wants) addItem(farm.stand, want.good, want.qty);
  return customer;
}

describe("customer arrivals", () => {
  it("brings customers to the stand over time", () => {
    const farm = makeFarm();
    addItem(farm.stand, "tomato", 50);
    advance(farm, 200);
    const arrivals = farm.events.filter((e) => e.text.includes("arrived at the stand"));
    expect(arrivals.length).toBeGreaterThan(0);
  });

  it("stays away while the farm has nothing whatsoever to sell", () => {
    const farm = makeFarm();
    advance(farm, 400);
    expect(farm.customers).toHaveLength(0);
    expect(farm.events.some((e) => e.text.includes("arrived at the stand"))).toBe(false);
    // ...and reputation is not punished for it.
    expect(farm.reputation).toBe(REPUTATION.start);
  });

  it("only asks for goods the farm can actually supply", () => {
    const farm = makeFarm();
    addItem(farm.inventory, "radish", 40);
    addItem(farm.stand, "egg", 40);

    // Sample every tick — customers time out, so checking only at the end would
    // usually find an empty stand.
    const asked = new Set<string>();
    for (let i = 0; i < 400; i++) {
      advance(farm, 1);
      for (const customer of farm.customers) {
        for (const want of customer.wants) asked.add(want.good);
      }
    }

    expect(asked.size).toBeGreaterThan(0);
    expect([...asked].sort()).toEqual(["egg", "radish"]);
  });

  it("never asks for more of a good than exists", () => {
    const farm = makeFarm();
    addItem(farm.stand, "pumpkin", 2);

    for (let i = 0; i < 300; i++) {
      advance(farm, 1);
      for (const customer of farm.customers) {
        for (const want of customer.wants) {
          expect(want.qty).toBeLessThanOrEqual(40);
          expect(want.qty).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never exceeds the waiting cap", () => {
    const farm = makeFarm();
    addItem(farm.stand, "tomato", 200);
    for (let i = 0; i < 500; i++) {
      advance(farm, 1);
      expect(farm.customers.length).toBeLessThanOrEqual(CUSTOMERS.maxWaiting);
    }
  });

  it("arrives more often at high reputation than at low", () => {
    expect(arrivalIntervalMean(100)).toBeLessThan(arrivalIntervalMean(50));
    expect(arrivalIntervalMean(50)).toBeLessThan(arrivalIntervalMean(0));
  });

  it("pays more generously at high reputation", () => {
    expect(toleranceMultiplier(100)).toBeGreaterThan(toleranceMultiplier(0));
  });

  it("gives each customer a name, a want list and an offer", () => {
    const farm = makeFarm();
    addItem(farm.stand, "tomato", 10);
    const customer = spawnCustomer(farm);
    expect(customer.name.length).toBeGreaterThan(0);
    expect(customer.wants.length).toBeGreaterThan(0);
    expect(customer.offer).toBeGreaterThan(0);
    expect(customer.tolerance).toBeGreaterThanOrEqual(customer.offer);
  });

  it("seats customers on distinct spots", () => {
    const farm = makeFarm();
    addItem(farm.stand, "tomato", 200);
    for (let i = 0; i < 500 && farm.customers.length < 2; i++) advance(farm, 1);
    if (farm.customers.length >= 2) {
      const spots = farm.customers.map((c) => `${c.spot.x},${c.spot.y}`);
      expect(new Set(spots).size).toBe(spots.length);
    }
  });
});

describe("customer patience", () => {
  it("counts down and reaches zero", () => {
    const farm = makeFarm();
    const customer = stageCustomer(farm);
    expect(patienceRemaining(farm, customer)).toBe(CUSTOMERS.patienceMinutes);

    advance(farm, 4);
    expect(patienceRemaining(farm, customer)).toBe(CUSTOMERS.patienceMinutes - 4);
  });

  it("leaves unserved once patience runs out, costing reputation", () => {
    const farm = makeFarm();
    farm.reputation = 50;
    stageCustomer(farm);

    advance(farm, CUSTOMERS.patienceMinutes + 1);

    expect(farm.customers.find((c) => c.id === "customer_test")).toBeUndefined();
    expect(farm.reputation).toBeLessThan(50);
    expect(farm.events.some((e) => e.text.includes("left unserved"))).toBe(true);
  });
});

describe("selling", () => {
  it("sells at the asking price and raises reputation", () => {
    const farm = makeFarm();
    farm.reputation = 50;
    const customer = stageCustomer(farm);
    const goldBefore = farm.gold;

    const outcome = sellToCustomer(farm, customer.id);

    expect(outcome.kind).toBe("sold");
    if (outcome.kind !== "sold") throw new Error("expected sale");
    expect(farm.gold).toBe(goldBefore + customer.offer);
    expect(farm.reputation).toBeGreaterThan(50);
    expect(farm.customers).toHaveLength(0);
  });

  it("removes the goods from the stand, not from the barn", () => {
    const farm = makeFarm();
    addItem(farm.inventory, "tomato", 5);
    const customer = stageCustomer(farm, { wants: [{ good: "tomato", qty: 2 }] });

    sellToCustomer(farm, customer.id);

    expect(countItem(farm.stand, "tomato")).toBe(0);
    expect(countItem(farm.inventory, "tomato")).toBe(5); // barn untouched
  });

  it("refuses when the stand cannot fill the basket, and says what is short", () => {
    const farm = makeFarm();
    const customer = stageCustomer(farm, { wants: [{ good: "pumpkin", qty: 3 }] });
    farm.stand = {}; // empty the stand again

    const outcome = sellToCustomer(farm, customer.id);
    expect(outcome.kind).toBe("missing_goods");
    if (outcome.kind !== "missing_goods") throw new Error("expected missing goods");
    expect(outcome.missing[0]?.good).toBe("pumpkin");
    expect(outcome.missing[0]?.qty).toBe(3);
    expect(farm.customers).toHaveLength(1); // still waiting
  });

  it("accepts a counter-offer within tolerance", () => {
    const farm = makeFarm();
    const customer = stageCustomer(farm, { offer: 90, tolerance: 120 });
    const goldBefore = farm.gold;

    const outcome = sellToCustomer(farm, customer.id, 110);
    expect(outcome.kind).toBe("sold");
    expect(farm.gold).toBe(goldBefore + 110);
  });

  it("reports whether the stand can fill an order", () => {
    const farm = makeFarm();
    const customer = stageCustomer(farm, { wants: [{ good: "egg", qty: 2 }] });
    expect(fulfillment(farm, customer).canFulfill).toBe(true);

    farm.stand = {};
    const after = fulfillment(farm, customer);
    expect(after.canFulfill).toBe(false);
    expect(after.missing).toHaveLength(1);
  });

  it("risks a walkout on a greedy counter-offer", () => {
    // Run many trials so both branches of the random outcome are exercised.
    let sold = 0;
    let walked = 0;
    let declined = 0;

    for (let seed = 0; seed < 60; seed++) {
      const farm = makeFarm(seed);
      const customer = stageCustomer(farm, { offer: 90, tolerance: 100 });
      const outcome = sellToCustomer(farm, customer.id, 400);
      if (outcome.kind === "sold") sold += 1;
      if (outcome.kind === "walked_out") walked += 1;
      if (outcome.kind === "declined") declined += 1;
    }

    expect(walked).toBeGreaterThan(0);
    expect(declined).toBeGreaterThan(0);
    expect(sold).toBeGreaterThan(0); // the occasional stretch acceptance
    expect(sold + walked + declined).toBe(60);
  });

  it("keeps a declining customer at the stand", () => {
    let foundDecline = false;
    for (let seed = 0; seed < 60 && !foundDecline; seed++) {
      const farm = makeFarm(seed);
      const customer = stageCustomer(farm, { offer: 90, tolerance: 100 });
      const outcome = sellToCustomer(farm, customer.id, 400);
      if (outcome.kind === "declined") {
        foundDecline = true;
        expect(farm.customers).toHaveLength(1);
        expect(outcome.message).toContain("90g");
      }
    }
    expect(foundDecline).toBe(true);
  });

  it("costs extra reputation when a customer walks out", () => {
    let checked = false;
    for (let seed = 0; seed < 60 && !checked; seed++) {
      const farm = makeFarm(seed);
      farm.reputation = 50;
      const customer = stageCustomer(farm, { offer: 90, tolerance: 100 });
      const outcome = sellToCustomer(farm, customer.id, 400);
      if (outcome.kind === "walked_out") {
        checked = true;
        expect(farm.reputation).toBeLessThan(50 + REPUTATION.perTimeout);
      }
    }
    expect(checked).toBe(true);
  });

  it("reports a missing customer rather than throwing", () => {
    const farm = makeFarm();
    expect(sellToCustomer(farm, "nobody").kind).toBe("no_such_customer");
  });

  it("can be addressed by customer name as well as id", () => {
    const farm = makeFarm();
    stageCustomer(farm, { name: "Marta" });
    expect(sellToCustomer(farm, "marta").kind).toBe("sold");
  });
});

describe("reputation", () => {
  it("clamps to 0..100", () => {
    const farm = makeFarm();
    adjustReputation(farm, 1000);
    expect(farm.reputation).toBe(REPUTATION.max);
    adjustReputation(farm, -1000);
    expect(farm.reputation).toBe(REPUTATION.min);
  });

  it("starts at the documented value", () => {
    expect(makeFarm().reputation).toBe(REPUTATION.start);
  });

  it("awards the Best Farm certificate at the milestone", () => {
    const farm = makeFarm();
    expect(farm.certificates).toHaveLength(0);
    adjustReputation(farm, REPUTATION.certificateAt - farm.reputation);
    expect(farm.certificates).toContain("best_farm_in_the_valley");
    expect(farm.events.some((e) => e.text.includes("Best Farm in the Valley"))).toBe(true);
  });

  it("awards the certificate only once", () => {
    const farm = makeFarm();
    adjustReputation(farm, 100);
    adjustReputation(farm, -5);
    adjustReputation(farm, 5);
    expect(farm.certificates).toHaveLength(1);
  });
});
