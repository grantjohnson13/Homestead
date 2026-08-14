import { describe, expect, it } from "vitest";
import { GOODS } from "../../src/data/items.ts";
import { CUSTOMERS, PRICING, REPUTATION } from "../../src/sim/constants.ts";
import {
  addItem,
  adjustReputation,
  advance,
  affordable,
  arrivalIntervalMean,
  basketPrice,
  countItem,
  fulfillment,
  patienceRemaining,
  priceOf,
  pricingInsights,
  sellToCustomer,
  setPrices,
  spawnCustomer,
  willingnessMultiplier,
  type Customer,
  type FarmState,
} from "../../src/sim/index.ts";
import { makeFarm } from "./helpers.ts";

/**
 * Puts a specific, fully-stocked customer at the stand and holds off further
 * arrivals, so a test is asserting about the customer it staged rather than
 * whoever wandered in during `advance`.
 */
function stageCustomer(farm: FarmState, overrides: Partial<Customer> = {}): Customer {
  farm.nextCustomerAt = Number.MAX_SAFE_INTEGER;
  const customer: Customer = {
    id: "customer_test",
    name: "Testy",
    portrait: 0,
    wants: [{ good: "tomato", qty: 2 }],
    maxPrice: 200,
    arrivedAt: farm.clock,
    patience: CUSTOMERS.patienceMinutes,
    spot: { x: 7, y: 10 },
    ...overrides,
  };
  farm.customers.push(customer);
  for (const want of customer.wants) addItem(farm.stand, want.good, want.qty);
  return customer;
}

describe("prices", () => {
  it("starts every good at the market reference price", () => {
    const farm = makeFarm();
    expect(priceOf(farm, "tomato")).toBe(GOODS.tomato.basePrice);
    expect(priceOf(farm, "egg")).toBe(GOODS.egg.basePrice);
  });

  it("sets a price and reports the change", () => {
    const farm = makeFarm();
    const before = priceOf(farm, "tomato");
    const result = setPrices(farm, { tomato: 70 });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.changes).toEqual([{ good: "tomato", from: before, to: 70 }]);
    expect(priceOf(farm, "tomato")).toBe(70);
  });

  it("leaves untouched goods alone", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 70 });
    expect(priceOf(farm, "egg")).toBe(GOODS.egg.basePrice);
  });

  it("reports no change when the price is already set", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 70 });
    const again = setPrices(farm, { tomato: 70 });
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error("expected success");
    expect(again.changes).toEqual([]);
  });

  it("rejects unknown goods and nonsense values", () => {
    const farm = makeFarm();
    expect(setPrices(farm, { tractor: 5 }).ok).toBe(false);
    expect(setPrices(farm, { tomato: 0 }).ok).toBe(false);
    expect(setPrices(farm, { tomato: -4 }).ok).toBe(false);
    expect(setPrices(farm, {}).ok).toBe(false);
  });

  it("clamps a price to a sane band rather than accepting a typo", () => {
    const farm = makeFarm();
    setPrices(farm, { radish: 999999 });
    expect(priceOf(farm, "radish")).toBe(GOODS.radish.basePrice * PRICING.maxPriceMultiple);

    setPrices(farm, { radish: 0.0001 });
    expect(priceOf(farm, "radish")).toBe(
      Math.round(GOODS.radish.basePrice * PRICING.minPriceMultiple),
    );
  });

  it("prices a basket at the current list price", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 50, egg: 10 });
    expect(
      basketPrice(farm, [
        { good: "tomato", qty: 2 },
        { good: "egg", qty: 3 },
      ]),
    ).toBe(2 * 50 + 3 * 10);
  });
});

describe("customers buy on their own", () => {
  it("sells without any tool call when price and stock line up", () => {
    const farm = makeFarm();
    const goldBefore = farm.gold;
    stageCustomer(farm, { maxPrice: 500 });

    advance(farm, 1);

    expect(farm.customers).toHaveLength(0);
    expect(farm.gold).toBeGreaterThan(goldBefore);
    expect(farm.events.some((e) => e.text.includes("Sold"))).toBe(true);
  });

  it("charges exactly the list price", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 40 });
    const goldBefore = farm.gold;
    stageCustomer(farm, { wants: [{ good: "tomato", qty: 2 }], maxPrice: 500 });

    advance(farm, 1);
    expect(farm.gold).toBe(goldBefore + 80);
  });

  it("waits rather than buying when the price is above their ceiling", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 100 });
    stageCustomer(farm, { wants: [{ good: "tomato", qty: 2 }], maxPrice: 50 });

    advance(farm, 5);
    expect(farm.customers).toHaveLength(1);
    expect(farm.gold).toBe(500);
  });

  it("buys the moment prices are cut within reach", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 100 });
    stageCustomer(farm, { wants: [{ good: "tomato", qty: 2 }], maxPrice: 90 });

    advance(farm, 5);
    expect(farm.customers).toHaveLength(1);

    // A price cut rescues the sale without any per-customer negotiation.
    setPrices(farm, { tomato: 40 });
    advance(farm, 1);

    expect(farm.customers).toHaveLength(0);
    expect(farm.gold).toBe(580);
  });

  it("waits when the stand cannot fill the order, however cheap", () => {
    const farm = makeFarm();
    setPrices(farm, { pumpkin: 1 });
    const customer = stageCustomer(farm, {
      wants: [{ good: "pumpkin", qty: 3 }],
      maxPrice: 5000,
    });
    farm.stand = {};

    advance(farm, 5);
    expect(farm.customers).toHaveLength(1);
    expect(fulfillment(farm, customer).canFulfill).toBe(false);
  });

  it("takes the goods off the stand and not out of the barn", () => {
    const farm = makeFarm();
    addItem(farm.inventory, "tomato", 5);
    stageCustomer(farm, { wants: [{ good: "tomato", qty: 2 }], maxPrice: 500 });

    advance(farm, 1);

    expect(countItem(farm.stand, "tomato")).toBe(0);
    expect(countItem(farm.inventory, "tomato")).toBe(5);
  });

  it("raises reputation on every sale", () => {
    const farm = makeFarm();
    farm.reputation = 50;
    stageCustomer(farm, { maxPrice: 500 });

    advance(farm, 1);
    expect(farm.reputation).toBeGreaterThan(50);
  });
});

describe("lost sales", () => {
  it("records a walkout over price, and what they would have paid", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 200 });
    stageCustomer(farm, { wants: [{ good: "tomato", qty: 2 }], maxPrice: 60 });

    advance(farm, CUSTOMERS.patienceMinutes + 1);

    expect(farm.customers).toHaveLength(0);
    expect(farm.lostSales).toHaveLength(1);

    const lost = farm.lostSales[0];
    expect(lost?.reason).toBe("price");
    expect(lost?.yourPrice).toBe(400);
    expect(lost?.theirMax).toBe(60);
    expect(lost?.customer).toBe("Testy");
  });

  it("records a walkout over empty shelves", () => {
    const farm = makeFarm();
    const customer = stageCustomer(farm, { wants: [{ good: "egg", qty: 2 }], maxPrice: 500 });
    farm.stand = {};
    void customer;

    advance(farm, CUSTOMERS.patienceMinutes + 1);

    const lost = farm.lostSales[0];
    expect(lost?.reason).toBe("stock");
    expect(lost?.missing.join(" ")).toContain("egg");
  });

  it("punishes an empty shelf harder than a high price", () => {
    expect(REPUTATION.perTimeout).toBeLessThan(REPUTATION.perPriceWalkout);
  });

  it("costs reputation when someone walks over price", () => {
    const farm = makeFarm();
    farm.reputation = 50;
    setPrices(farm, { tomato: 300 });
    stageCustomer(farm, { wants: [{ good: "tomato", qty: 2 }], maxPrice: 10 });

    advance(farm, CUSTOMERS.patienceMinutes + 1);
    expect(farm.reputation).toBe(50 + REPUTATION.perPriceWalkout);
  });

  it("keeps the lost-sale log bounded", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 400 });

    for (let i = 0; i < PRICING.maxLostSales + 12; i++) {
      stageCustomer(farm, {
        id: `customer_${i}`,
        wants: [{ good: "tomato", qty: 1 }],
        maxPrice: 1,
      });
      advance(farm, CUSTOMERS.patienceMinutes + 1);
    }

    expect(farm.lostSales.length).toBeLessThanOrEqual(PRICING.maxLostSales);
  });

  it("turns the log into a suggested price", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 100 });
    stageCustomer(farm, { wants: [{ good: "tomato", qty: 2 }], maxPrice: 120 });

    advance(farm, CUSTOMERS.patienceMinutes + 1);

    const insights = pricingInsights(farm);
    const tomato = insights.find((i) => i.good === "tomato");
    expect(tomato).toBeDefined();
    expect(tomato?.walkedOnPrice).toBe(1);
    // They'd have paid 120 for two, so about 60 each against your 100.
    expect(tomato?.suggestedPrice).toBe(60);
    expect(tomato?.suggestedPrice).toBeLessThan(tomato?.yourPrice as number);
  });

  it("ignores stock walkouts when suggesting prices", () => {
    const farm = makeFarm();
    stageCustomer(farm, { wants: [{ good: "egg", qty: 2 }], maxPrice: 500 });
    farm.stand = {};

    advance(farm, CUSTOMERS.patienceMinutes + 1);
    expect(pricingInsights(farm)).toEqual([]);
  });
});

describe("willingness to pay", () => {
  it("rises with reputation", () => {
    expect(willingnessMultiplier(100)).toBeGreaterThan(willingnessMultiplier(0));
  });

  it("is anchored to the reference price, not to your asking price", () => {
    // Otherwise raising prices would raise what people will pay, and the whole
    // lever would do nothing.
    const cheap = makeFarm(7);
    const dear = makeFarm(7);
    addItem(cheap.stand, "tomato", 20);
    addItem(dear.stand, "tomato", 20);
    setPrices(dear, { tomato: 500 });

    expect(spawnCustomer(dear).maxPrice).toBe(spawnCustomer(cheap).maxPrice);
  });

  it("gives every customer a plausible ceiling", () => {
    const farm = makeFarm();
    addItem(farm.stand, "tomato", 40);
    for (let i = 0; i < 40; i++) {
      const customer = spawnCustomer(farm);
      expect(customer.maxPrice).toBeGreaterThan(0);
      expect(customer.wants.length).toBeGreaterThan(0);
    }
  });
});

describe("customer arrivals", () => {
  it("brings customers to the stand over time", () => {
    const farm = makeFarm();
    // Priced out of reach so they linger instead of buying instantly.
    setPrices(farm, { tomato: 400 });
    addItem(farm.stand, "tomato", 200);

    advance(farm, 400);
    expect(farm.events.some((e) => e.text.includes("arrived at the stand"))).toBe(true);
  });

  it("stays away while the farm has nothing whatsoever to sell", () => {
    const farm = makeFarm();
    advance(farm, 400);
    expect(farm.customers).toHaveLength(0);
    expect(farm.reputation).toBe(REPUTATION.start);
  });

  it("never exceeds the waiting cap", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 400 });
    addItem(farm.stand, "tomato", 500);

    for (let i = 0; i < 600; i++) {
      advance(farm, 1);
      expect(farm.customers.length).toBeLessThanOrEqual(CUSTOMERS.maxWaiting);
    }
  });

  it("arrives more often at high reputation", () => {
    expect(arrivalIntervalMean(100)).toBeLessThan(arrivalIntervalMean(50));
    expect(arrivalIntervalMean(50)).toBeLessThan(arrivalIntervalMean(0));
  });

  it("counts down patience", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 999 });
    const customer = stageCustomer(farm, { maxPrice: 1 });

    expect(patienceRemaining(farm, customer)).toBe(CUSTOMERS.patienceMinutes);
    advance(farm, 4);
    expect(patienceRemaining(farm, customer)).toBe(CUSTOMERS.patienceMinutes - 4);
  });
});

describe("closing a sale by hand", () => {
  it("sells at the list price by default", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 45 });
    const customer = stageCustomer(farm, {
      wants: [{ good: "tomato", qty: 2 }],
      maxPrice: 500,
    });

    const outcome = sellToCustomer(farm, customer.id);
    expect(outcome.kind).toBe("sold");
    if (outcome.kind !== "sold") throw new Error("expected a sale");
    expect(outcome.price).toBe(90);
  });

  it("accepts a one-off discount below the list price", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 200 });
    const customer = stageCustomer(farm, {
      wants: [{ good: "tomato", qty: 2 }],
      maxPrice: 100,
    });

    // The list price would lose them; a one-off deal rescues the sale.
    const outcome = sellToCustomer(farm, customer.id, 95);
    expect(outcome.kind).toBe("sold");
    expect(farm.gold).toBe(595);
  });

  it("refuses a hand-sale above what they will pay", () => {
    const farm = makeFarm();
    const customer = stageCustomer(farm, { maxPrice: 50 });

    const outcome = sellToCustomer(farm, customer.id, 400);
    expect(outcome.kind).toBe("too_expensive");
    expect(farm.customers).toHaveLength(1);
  });

  it("reports what the stand is short", () => {
    const farm = makeFarm();
    const customer = stageCustomer(farm, { wants: [{ good: "pumpkin", qty: 3 }] });
    farm.stand = {};

    const outcome = sellToCustomer(farm, customer.id);
    expect(outcome.kind).toBe("missing_goods");
    if (outcome.kind !== "missing_goods") throw new Error("expected missing goods");
    expect(outcome.missing[0]?.good).toBe("pumpkin");
  });

  it("reports a missing customer rather than throwing", () => {
    expect(sellToCustomer(makeFarm(), "nobody").kind).toBe("no_such_customer");
  });

  it("can be addressed by name", () => {
    const farm = makeFarm();
    stageCustomer(farm, { name: "Marta", maxPrice: 500 });
    expect(sellToCustomer(farm, "marta").kind).toBe("sold");
  });
});

describe("affordability reporting", () => {
  it("says whether your price is within reach", () => {
    const farm = makeFarm();
    setPrices(farm, { tomato: 30, pumpkin: 300 });

    const cheap = stageCustomer(farm, {
      id: "a",
      wants: [{ good: "tomato", qty: 1 }],
      maxPrice: 100,
    });
    const dear = stageCustomer(farm, {
      id: "b",
      wants: [{ good: "pumpkin", qty: 1 }],
      maxPrice: 10,
    });

    expect(affordable(farm, cheap)).toBe(true);
    expect(affordable(farm, dear)).toBe(false);
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

  it("awards the Best Farm certificate once, at the milestone", () => {
    const farm = makeFarm();
    expect(farm.certificates).toHaveLength(0);
    adjustReputation(farm, REPUTATION.certificateAt - farm.reputation);
    expect(farm.certificates).toContain("best_farm_in_the_valley");

    adjustReputation(farm, -5);
    adjustReputation(farm, 5);
    expect(farm.certificates).toHaveLength(1);
  });
});
