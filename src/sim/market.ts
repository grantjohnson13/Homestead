/**
 * Customers, pricing, and reputation.
 *
 * You set a price list; customers arrive with a private ceiling for their
 * basket and buy on their own the moment your price is at or under it and the
 * stand can fill the order. Nobody has to be standing at the counter.
 *
 * This replaced a per-customer haggling flow, which asked a turn-based player to
 * react to a real-time queue: customers routinely expired mid-sentence, in front
 * of goods they wanted. A price list is a standing decision that keeps working
 * between turns — and losing the occasional sale to a high price is how you
 * learn what the valley will bear.
 */

import { BASKET_SHAPES, CUSTOMER_PROFILES, type CustomerProfile } from "../data/customers.ts";
import { GOODS, GOOD_IDS, describeGood, type GoodId } from "../data/items.ts";
import { CUSTOMER_SPOTS } from "../data/map.ts";
import { CUSTOMERS, PRICING, REPUTATION } from "./constants.ts";
import { countItem, logEvent, nextId, takeItem } from "./farm.ts";
import { chance, pick, poissonInterval, rand, randInt } from "./rng.ts";
import type { Customer, CustomerWant, FarmState, LostSale, LostSaleReason } from "./types.ts";

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
  const scale = byReputation(reputation, CUSTOMERS.intervalAtMinRep, 1, CUSTOMERS.intervalAtMaxRep);
  return Math.max(1, CUSTOMERS.baseIntervalMinutes * scale);
}

/** How much above the reference price the valley will bear at this reputation. */
export function willingnessMultiplier(reputation: number): number {
  return byReputation(
    reputation,
    PRICING.willingnessAtMinRep,
    (PRICING.willingnessAtMinRep + PRICING.willingnessAtMaxRep) / 2,
    PRICING.willingnessAtMaxRep,
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

/* --------------------------------------------------------------- pricing -- */

/** Your asking price for one unit, falling back to the reference price. */
export function priceOf(state: FarmState, good: GoodId): number {
  const set = state.prices[good];
  return typeof set === "number" && Number.isFinite(set) ? set : GOODS[good].basePrice;
}

/** What a basket costs at your current prices. */
export function basketPrice(state: FarmState, wants: readonly CustomerWant[]): number {
  return wants.reduce((total, want) => total + priceOf(state, want.good) * want.qty, 0);
}

export interface PriceChange {
  good: GoodId;
  from: number;
  to: number;
}

export type PriceUpdate = { ok: true; changes: PriceChange[] } | { ok: false; reason: string };

/**
 * Sets asking prices. Values are clamped to a sane band around the reference
 * price so a typo cannot make the whole farm unsellable or free.
 */
export function setPrices(state: FarmState, updates: Record<string, number>): PriceUpdate {
  const entries = Object.entries(updates);
  if (entries.length === 0) return { ok: false, reason: "No prices given." };

  const changes: PriceChange[] = [];
  for (const [good, value] of entries) {
    if (!(GOOD_IDS as readonly string[]).includes(good)) {
      return {
        ok: false,
        reason: `"${good}" is not something the stand sells. Sellable goods: ${GOOD_IDS.join(", ")}.`,
      };
    }
    if (!Number.isFinite(value) || value <= 0) {
      return {
        ok: false,
        reason: `Price for ${good} must be a positive number, got ${String(value)}.`,
      };
    }

    const reference = GOODS[good as GoodId].basePrice;
    const clamped = Math.round(
      Math.max(
        reference * PRICING.minPriceMultiple,
        Math.min(reference * PRICING.maxPriceMultiple, value),
      ),
    );
    const from = priceOf(state, good as GoodId);
    if (from !== clamped) {
      state.prices[good] = clamped;
      changes.push({ good: good as GoodId, from, to: clamped });
    }
  }

  return { ok: true, changes };
}

/* -------------------------------------------------------------- arrivals -- */

export function tickCustomers(state: FarmState): void {
  // Anyone who can be served, is — this is what keeps the stand working while
  // the player is mid-conversation.
  serveWhoWeCan(state);

  for (const customer of [...state.customers]) {
    if (state.clock - customer.arrivedAt < customer.patience) continue;
    giveUp(state, customer);
  }

  if (state.clock < state.nextCustomerAt) return;

  // Reschedule regardless, so a full stand doesn't cause a backlog burst.
  state.nextCustomerAt =
    state.clock + poissonInterval(state, arrivalIntervalMean(state.reputation));

  if (state.customers.length >= CUSTOMERS.maxWaiting) return;

  // Nobody walks up to a farm with nothing to sell.
  if (sellableGoods(state).length === 0) return;

  const customer = spawnCustomer(state);
  state.customers.push(customer);
  logEvent(
    state,
    "customer",
    `${customer.name} arrived at the stand wanting ${describeWants(customer.wants)} ` +
      `(your price: ${basketPrice(state, customer.wants)}g).`,
  );
}

/** Sells to every waiting customer whose order the stand can fill at your price. */
function serveWhoWeCan(state: FarmState): void {
  for (const customer of [...state.customers]) {
    if (!fulfillment(state, customer).canFulfill) continue;
    const price = basketPrice(state, customer.wants);
    if (price > customer.maxPrice) continue;
    completeSale(state, customer, price);
  }
}

/** A customer's patience has run out; record why they left empty-handed. */
function giveUp(state: FarmState, customer: Customer): void {
  const { missing } = fulfillment(state, customer);
  const price = basketPrice(state, customer.wants);
  const reason: LostSaleReason = missing.length > 0 ? "stock" : "price";

  removeCustomer(state, customer.id);

  const delta = adjustReputation(
    state,
    reason === "price" ? REPUTATION.perPriceWalkout : REPUTATION.perTimeout,
  );

  recordLostSale(state, {
    at: Math.floor(state.clock),
    customer: customer.name,
    reason,
    wants: customer.wants.map((w) => ({ ...w })),
    yourPrice: price,
    theirMax: customer.maxPrice,
    missing: missing.map((m) => describeGood(m.good, m.qty)),
  });

  if (reason === "price") {
    logEvent(
      state,
      "customer",
      `${customer.name} baulked at ${price}g for ${describeWants(customer.wants)} and left ` +
        `(they'd have paid ${customer.maxPrice}g) (${delta} rep).`,
    );
  } else {
    logEvent(
      state,
      "customer",
      `${customer.name} left unserved — the stand was short ${missing
        .map((m) => describeGood(m.good, m.qty))
        .join(" and ")} (${delta} rep).`,
    );
  }
}

function recordLostSale(state: FarmState, lost: LostSale): void {
  state.lostSales.push(lost);
  if (state.lostSales.length > PRICING.maxLostSales) {
    state.lostSales.splice(0, state.lostSales.length - PRICING.maxLostSales);
  }
}

function describeWants(wants: readonly CustomerWant[]): string {
  return wants.map((w) => describeGood(w.good, w.qty)).join(" and ");
}

export function spawnCustomer(state: FarmState): Customer {
  const profile = pick(state, CUSTOMER_PROFILES);
  const wants = buildBasket(state, profile);

  // Their ceiling is anchored to the reference price, not to yours — otherwise
  // raising prices would raise what they'll pay and the lever would do nothing.
  const reference = wants.reduce((sum, w) => sum + GOODS[w.good].basePrice * w.qty, 0);
  const jitter = 1 + (rand(state) * 2 - 1) * PRICING.willingnessJitter;
  const maxPrice = Math.max(
    1,
    Math.round(
      reference *
        willingnessMultiplier(state.reputation) *
        profile.generosity *
        profile.flexibility *
        jitter,
    ),
  );

  const taken = new Set(state.customers.map((c) => `${c.spot.x},${c.spot.y}`));
  const spot =
    CUSTOMER_SPOTS.find((s) => !taken.has(`${s.x},${s.y}`)) ??
    (CUSTOMER_SPOTS[0] as (typeof CUSTOMER_SPOTS)[number]);

  return {
    id: nextId(state, "customer"),
    name: profile.name,
    portrait: profile.portrait,
    wants,
    maxPrice,
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

/** Whether your asking price is within what this customer would pay. */
export function affordable(state: FarmState, customer: Customer): boolean {
  return basketPrice(state, customer.wants) <= customer.maxPrice;
}

/* ---------------------------------------------------------------- selling -- */

export type SaleOutcome =
  | { kind: "sold"; price: number; reputationDelta: number; customer: Customer }
  | { kind: "missing_goods"; missing: CustomerWant[] }
  | { kind: "too_expensive"; customer: Customer; yourPrice: number }
  | { kind: "no_such_customer" };

/**
 * Closes a sale by hand.
 *
 * Rarely needed now that the stand serves itself, but useful for a one-off deal
 * below your list price to clear stock or rescue a customer who is about to
 * walk. Omitting `price` sells at your list price.
 */
export function sellToCustomer(state: FarmState, customerId: string, price?: number): SaleOutcome {
  const customer = findCustomer(state, customerId);
  if (!customer) return { kind: "no_such_customer" };

  const { canFulfill, missing } = fulfillment(state, customer);
  if (!canFulfill) return { kind: "missing_goods", missing };

  const asking = price === undefined ? basketPrice(state, customer.wants) : Math.round(price);
  if (asking > customer.maxPrice) {
    return { kind: "too_expensive", customer, yourPrice: asking };
  }

  return completeSale(state, customer, asking);
}

function completeSale(state: FarmState, customer: Customer, price: number): SaleOutcome {
  for (const want of customer.wants) {
    takeItem(state.stand, want.good, want.qty);
  }
  state.gold += price;
  removeCustomer(state, customer.id);

  const delta = adjustReputation(state, REPUTATION.perSale);

  logEvent(
    state,
    "economy",
    `Sold ${describeWants(customer.wants)} to ${customer.name} for ${price}g (+${delta} rep).`,
  );

  return { kind: "sold", price, reputationDelta: delta, customer };
}

/* ------------------------------------------------------------ lost sales -- */

export interface PricingInsight {
  good: GoodId;
  yourPrice: number;
  referencePrice: number;
  /** Lost sales involving this good because of price. */
  walkedOnPrice: number;
  /** Highest per-unit price anyone who walked would have accepted. */
  suggestedPrice: number | null;
}

/**
 * Turns the lost-sale log into advice: for each good that has cost you sales,
 * roughly what the customers who walked would have paid per unit.
 *
 * This is what makes pricing learnable — you find the ceiling by bumping into
 * it, and the game tells you how hard you hit.
 */
export function pricingInsights(state: FarmState): PricingInsight[] {
  const byGood = new Map<GoodId, { walked: number; impliedUnit: number[] }>();

  for (const lost of state.lostSales) {
    if (lost.reason !== "price" || lost.yourPrice <= 0) continue;
    // Spread their ceiling across the basket in proportion to your own prices.
    const ratio = lost.theirMax / lost.yourPrice;
    for (const want of lost.wants) {
      const entry = byGood.get(want.good) ?? { walked: 0, impliedUnit: [] };
      entry.walked += 1;
      entry.impliedUnit.push(priceOf(state, want.good) * ratio);
      byGood.set(want.good, entry);
    }
  }

  return [...byGood.entries()].map(([good, entry]) => ({
    good,
    yourPrice: priceOf(state, good),
    referencePrice: GOODS[good].basePrice,
    walkedOnPrice: entry.walked,
    suggestedPrice:
      entry.impliedUnit.length > 0 ? Math.max(1, Math.floor(Math.max(...entry.impliedUnit))) : null,
  }));
}
