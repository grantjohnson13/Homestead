/**
 * Customers, haggling, and reputation.
 *
 * Customers arrive on a Poisson-ish timer whose mean is bent by reputation, ask
 * for a basket of goods, and wait a fixed patience before giving up. They buy
 * from the farm stand, never from barn storage.
 */

import { BASKET_SHAPES, CUSTOMER_PROFILES, type CustomerProfile } from "../data/customers.ts";
import { GOODS, GOOD_IDS, describeGood, type GoodId } from "../data/items.ts";
import { CUSTOMER_SPOTS } from "../data/map.ts";
import { CUSTOMERS, PRICING, REPUTATION } from "./constants.ts";
import { countItem, logEvent, nextId, takeItem } from "./farm.ts";
import { chance, pick, poissonInterval, randInt } from "./rng.ts";
import type { Customer, CustomerWant, FarmState } from "./types.ts";

/** Linear interpolation keyed on reputation, hinged at the midpoint. */
function byReputation(reputation: number, atMin: number, atMid: number, atMax: number): number {
  const r = Math.max(REPUTATION.min, Math.min(REPUTATION.max, reputation));
  const mid = (REPUTATION.min + REPUTATION.max) / 2;
  if (r <= mid) {
    const t = mid === REPUTATION.min ? 1 : (r - REPUTATION.min) / (mid - REPUTATION.min);
    return atMin + (atMid - atMin) * t;
  }
  const t = REPUTATION.max === mid ? 1 : (r - mid) / (REPUTATION.max - mid);
  return atMid + (atMax - atMid) * t;
}

export function arrivalIntervalMean(reputation: number): number {
  const scale = byReputation(
    reputation,
    CUSTOMERS.intervalAtMinRep,
    1,
    CUSTOMERS.intervalAtMaxRep,
  );
  return Math.max(1, CUSTOMERS.baseIntervalMinutes * scale);
}

export function toleranceMultiplier(reputation: number): number {
  return byReputation(
    reputation,
    PRICING.toleranceAtMinRep,
    (PRICING.toleranceAtMinRep + PRICING.toleranceAtMaxRep) / 2,
    PRICING.toleranceAtMaxRep,
  );
}

export function adjustReputation(state: FarmState, delta: number): number {
  const before = state.reputation;
  state.reputation = Math.max(REPUTATION.min, Math.min(REPUTATION.max, before + delta));
  const changed = state.reputation - before;

  if (
    state.reputation >= REPUTATION.certificateAt &&
    !state.certificates.includes("best_farm_in_the_valley")
  ) {
    state.certificates.push("best_farm_in_the_valley");
    logEvent(
      state,
      "system",
      'The valley council has named you "Best Farm in the Valley". A certificate now hangs on the stand.',
    );
  }
  return changed;
}

/* -------------------------------------------------------------- arrivals -- */

export function tickCustomers(state: FarmState): void {
  // Patience.
  for (const customer of [...state.customers]) {
    if (state.clock - customer.arrivedAt >= customer.patience) {
      removeCustomer(state, customer.id);
      const delta = adjustReputation(state, REPUTATION.perTimeout);
      logEvent(
        state,
        "customer",
        `${customer.name} waited as long as they could and left unserved (${delta} rep).`,
      );
    }
  }

  if (state.clock < state.nextCustomerAt) return;

  // Reschedule regardless, so a full stand doesn't cause a backlog burst.
  state.nextCustomerAt = state.clock + poissonInterval(state, arrivalIntervalMean(state.reputation));

  if (state.customers.length >= CUSTOMERS.maxWaiting) return;

  // Nobody walks up to a farm with nothing to sell. Without this, a starting
  // farm is visited by a queue of people wanting pumpkins it has never grown,
  // and reputation bleeds away for a failure the player could not have avoided.
  if (sellableGoods(state).length === 0) return;

  const customer = spawnCustomer(state);
  state.customers.push(customer);
  logEvent(
    state,
    "customer",
    `${customer.name} arrived at the stand wanting ${describeWants(customer.wants)} (offering ${customer.offer}g).`,
  );
}

function describeWants(wants: readonly CustomerWant[]): string {
  return wants.map((w) => describeGood(w.good, w.qty)).join(" and ");
}

export function spawnCustomer(state: FarmState): Customer {
  const profile = pick(state, CUSTOMER_PROFILES);
  const wants = buildBasket(state, profile);

  const listPrice = wants.reduce((sum, w) => sum + GOODS[w.good].basePrice * w.qty, 0);
  const repBonus = byReputation(state.reputation, 0.85, 1, 1.15);
  const offer = Math.max(1, Math.round(listPrice * profile.generosity * repBonus));
  const tolerance = Math.max(
    offer,
    Math.round(offer * toleranceMultiplier(state.reputation) * profile.flexibility),
  );

  const taken = new Set(state.customers.map((c) => `${c.spot.x},${c.spot.y}`));
  const spot =
    CUSTOMER_SPOTS.find((s) => !taken.has(`${s.x},${s.y}`)) ?? (CUSTOMER_SPOTS[0] as (typeof CUSTOMER_SPOTS)[number]);

  return {
    id: nextId(state, "customer"),
    name: profile.name,
    portrait: profile.portrait,
    wants,
    offer,
    tolerance,
    arrivedAt: state.clock,
    patience: CUSTOMERS.patienceMinutes,
    spot: { x: spot.x, y: spot.y },
  };
}

/**
 * Goods the farm could plausibly put on the stand right now — anything already
 * out front, plus anything sitting in the barn waiting to be carried over.
 */
export function sellableGoods(state: FarmState): GoodId[] {
  return GOOD_IDS.filter(
    (id) => countItem(state.stand, id) > 0 || countItem(state.inventory, id) > 0,
  );
}

/**
 * Builds a shopping list drawn strictly from what the farm can actually supply,
 * leaning toward this customer's favourites when they happen to be in stock.
 *
 * Quantities are capped at what exists, so a filled order is always achievable:
 * the only reason to lose a customer is being too slow, which is the player's
 * call to make.
 */
function buildBasket(state: FarmState, profile: CustomerProfile): CustomerWant[] {
  const shape = BASKET_SHAPES[profile.basketSize];
  const stocked = sellableGoods(state);
  if (stocked.length === 0) return [];

  const favoured = stocked.filter((id) => profile.favours.includes(id));
  const lineCount = Math.min(randInt(state, shape.lines[0], shape.lines[1]), stocked.length);

  const chosen: GoodId[] = [];
  for (let i = 0; i < lineCount; i++) {
    const preferred = favoured.filter((id) => !chosen.includes(id));
    const rest = stocked.filter((id) => !chosen.includes(id));
    const pool = preferred.length > 0 && chance(state, 0.65) ? preferred : rest;
    if (pool.length === 0) break;
    chosen.push(pick(state, pool));
  }

  return chosen.map((good) => {
    const available = countItem(state.stand, good) + countItem(state.inventory, good);
    const wanted = randInt(state, shape.perLine[0], shape.perLine[1]);
    return { good, qty: Math.max(1, Math.min(wanted, available)) };
  });
}

export function removeCustomer(state: FarmState, customerId: string): Customer | undefined {
  const index = state.customers.findIndex((c) => c.id === customerId);
  if (index < 0) return undefined;
  return state.customers.splice(index, 1)[0];
}

export function findCustomer(state: FarmState, idOrName: string): Customer | undefined {
  return state.customers.find(
    (c) => c.id === idOrName || c.name.toLowerCase() === idOrName.toLowerCase(),
  );
}

/** Game-minutes this customer has left before walking. */
export function patienceRemaining(state: FarmState, customer: Customer): number {
  return Math.max(0, customer.patience - (state.clock - customer.arrivedAt));
}

/** Whether the stand can fill this order right now, and what is short. */
export function fulfillment(
  state: FarmState,
  customer: Customer,
): { canFulfill: boolean; missing: CustomerWant[] } {
  const missing: CustomerWant[] = [];
  for (const want of customer.wants) {
    const have = countItem(state.stand, want.good);
    if (have < want.qty) missing.push({ good: want.good, qty: want.qty - have });
  }
  return { canFulfill: missing.length === 0, missing };
}

/* ---------------------------------------------------------------- selling -- */

export type SaleOutcome =
  | { kind: "sold"; price: number; reputationDelta: number; customer: Customer }
  | { kind: "missing_goods"; missing: CustomerWant[] }
  | { kind: "declined"; customer: Customer; message: string }
  | { kind: "walked_out"; customer: Customer; reputationDelta: number }
  | { kind: "no_such_customer" };

/**
 * Completes (or fails) a sale.
 *
 * `counterPrice` undefined means "accept their offer", which always succeeds if
 * the stand can fill the basket. A counter within tolerance is accepted; beyond
 * it, the customer usually declines and sometimes walks out entirely.
 */
export function sellToCustomer(
  state: FarmState,
  customerId: string,
  counterPrice?: number,
): SaleOutcome {
  const customer = findCustomer(state, customerId);
  if (!customer) return { kind: "no_such_customer" };

  const { canFulfill, missing } = fulfillment(state, customer);
  if (!canFulfill) return { kind: "missing_goods", missing };

  const price = counterPrice === undefined ? customer.offer : Math.round(counterPrice);

  if (price > customer.tolerance) {
    if (chance(state, PRICING.stretchAcceptChance)) {
      return completeSale(state, customer, price, true);
    }
    if (chance(state, PRICING.walkoutChance)) {
      removeCustomer(state, customer.id);
      const delta = adjustReputation(state, REPUTATION.perTimeout + REPUTATION.perWalkout);
      logEvent(
        state,
        "customer",
        `${customer.name} baulked at ${price}g and walked off (${delta} rep).`,
      );
      return { kind: "walked_out", customer, reputationDelta: delta };
    }
    logEvent(state, "customer", `${customer.name} shook their head at ${price}g but is still waiting.`);
    return {
      kind: "declined",
      customer,
      message: `${customer.name} won't pay ${price}g. They're still at the stand — try closer to their ${customer.offer}g offer.`,
    };
  }

  return completeSale(state, customer, price, false);
}

function completeSale(
  state: FarmState,
  customer: Customer,
  price: number,
  grudging: boolean,
): SaleOutcome {
  for (const want of customer.wants) {
    takeItem(state.stand, want.good, want.qty);
  }
  state.gold += price;
  removeCustomer(state, customer.id);

  const bonus = price > customer.offer ? 0 : 1;
  const delta = adjustReputation(state, REPUTATION.perSale + bonus);

  logEvent(
    state,
    "economy",
    `Sold ${describeWants(customer.wants)} to ${customer.name} for ${price}g${grudging ? " (they grumbled)" : ""} (+${delta} rep).`,
  );

  return { kind: "sold", price, reputationDelta: delta, customer };
}
