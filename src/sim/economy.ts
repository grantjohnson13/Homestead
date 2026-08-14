/**
 * Buying from the supply shop. Selling lives in market.ts, since it is bound up
 * with customers and reputation.
 */

import { ANIMALS } from "../data/animals.ts";
import { priceFor, shopItem } from "../data/shop.ts";
import { addAnimal, addItem, animalCapacityLeft, logEvent } from "./farm.ts";
import type { FarmState } from "./types.ts";

export type PurchaseOutcome =
  | { ok: true; itemId: string; qty: number; cost: number; names?: string[] }
  | { ok: false; reason: string };

export function buySupplies(state: FarmState, itemId: string, qty: number): PurchaseOutcome {
  if (!Number.isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) {
    return { ok: false, reason: `Quantity must be a whole number above zero, got ${String(qty)}.` };
  }

  const item = shopItem(itemId);
  if (!item) {
    return {
      ok: false,
      reason: `The shop doesn't stock "${itemId}". Call get_almanac to see what is for sale.`,
    };
  }

  if (item.kind === "animal") {
    const kind = item.animal as keyof typeof ANIMALS;
    const room = animalCapacityLeft(state, kind);
    if (room <= 0) {
      return {
        ok: false,
        reason: `The ${kind === "chicken" ? "coop" : "barn"} is full (${ANIMALS[kind].capacity} ${kind}s). Sell or rehome one first — or just enjoy the full house.`,
      };
    }
    if (qty > room) {
      return {
        ok: false,
        reason: `Only room for ${room} more ${kind}${room === 1 ? "" : "s"}, but ${qty} were requested.`,
      };
    }
  }

  const cost = priceFor(item, qty);
  if (cost > state.gold) {
    return {
      ok: false,
      reason: `That costs ${cost}g but the tin holds ${state.gold}g. Sell something first.`,
    };
  }

  state.gold -= cost;

  if (item.kind === "animal") {
    const kind = item.animal as keyof typeof ANIMALS;
    const names: string[] = [];
    for (let i = 0; i < qty; i++) names.push(addAnimal(state, kind).name);
    logEvent(
      state,
      "economy",
      `Bought ${qty} ${kind}${qty === 1 ? "" : "s"} for ${cost}g: ${names.join(", ")}.`,
    );
    return { ok: true, itemId, qty, cost, names };
  }

  addItem(state.inventory, item.id, qty);
  logEvent(state, "economy", `Bought ${qty} x ${item.name} for ${cost}g.`);
  return { ok: true, itemId, qty, cost };
}

/** What a purchase would cost, without committing to it. */
export function quote(itemId: string, qty: number): number | null {
  const item = shopItem(itemId);
  if (!item) return null;
  return priceFor(item, qty);
}
