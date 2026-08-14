/**
 * Where upgrades actually bite.
 *
 * Every tunable an upgrade touches is read through a function here rather than
 * from a constant directly, so there is exactly one place that knows how an
 * upgrade level turns into an effect. Callers ask "how big is the watering can
 * on *this* farm", not "what is WATER_CAN_CAPACITY".
 */

import { ANIMALS, type AnimalKind } from "../data/animals.ts";
import {
  UPGRADES,
  UPGRADE_EFFECTS,
  costOfNextLevel,
  isUpgradeId,
  maxLevel,
  type UpgradeId,
} from "../data/upgrades.ts";
import { CUSTOMERS } from "./constants.ts";
import { WATER_CAN_CAPACITY } from "./farm.ts";
import { CARRY_CAPACITY } from "./wren.ts";
import type { FarmState } from "./types.ts";

export function levelOf(state: FarmState, id: UpgradeId): number {
  const level = state.upgrades?.[id];
  return typeof level === "number" && level > 0 ? Math.min(level, maxLevel(id)) : 0;
}

/** How many plots Wren can water before refilling. */
export function waterCanCapacity(state: FarmState): number {
  return WATER_CAN_CAPACITY + levelOf(state, "watering_can") * UPGRADE_EFFECTS.waterCanPerLevel;
}

/** How many goods Wren can carry to the stand in one trip. */
export function carryCapacity(state: FarmState): number {
  return CARRY_CAPACITY + levelOf(state, "wheelbarrow") * UPGRADE_EFFECTS.carryPerLevel;
}

/** Multiplier on how long one watering lasts. */
export function moistureMultiplier(state: FarmState): number {
  return 1 + levelOf(state, "sprinklers") * UPGRADE_EFFECTS.moisturePerLevel;
}

/** Multiplier on the gap between customer arrivals; lower is busier. */
export function arrivalMultiplier(state: FarmState): number {
  return Math.max(0.2, 1 - levelOf(state, "market_stall") * UPGRADE_EFFECTS.arrivalSpeedPerLevel);
}

/** How long a customer will wait, in game-minutes. */
export function patienceMinutes(state: FarmState): number {
  return Math.round(
    CUSTOMERS.patienceMinutes *
      (1 + levelOf(state, "signboard") * UPGRADE_EFFECTS.patiencePerLevel),
  );
}

/** Multiplier on what customers are willing to pay. */
export function willingnessBonus(state: FarmState): number {
  return 1 + levelOf(state, "fine_stand") * UPGRADE_EFFECTS.willingnessPerLevel;
}

/** How many of this kind of animal the farm can house. */
export function housingFor(state: FarmState, kind: AnimalKind): number {
  const base = ANIMALS[kind].capacity;
  return kind === "chicken"
    ? base + levelOf(state, "coop_extension") * UPGRADE_EFFECTS.chickenPlacesPerLevel
    : base + levelOf(state, "barn_extension") * UPGRADE_EFFECTS.cowPlacesPerLevel;
}

/* ---------------------------------------------------------------- buying -- */

export type UpgradeOutcome =
  | { ok: true; id: UpgradeId; level: number; cost: number; effect: string }
  | { ok: false; reason: string };

export function buyUpgrade(state: FarmState, id: string): UpgradeOutcome {
  if (!isUpgradeId(id)) {
    return {
      ok: false,
      reason: `"${id}" is not something you can invest in. Options: ${Object.keys(UPGRADES).join(", ")}.`,
    };
  }

  const level = levelOf(state, id);
  const cost = costOfNextLevel(id, level);
  const def = UPGRADES[id];

  if (cost === null) {
    return { ok: false, reason: `${def.name} is already fully upgraded (level ${level}).` };
  }
  if (cost > state.gold) {
    return {
      ok: false,
      reason: `${def.name} costs ${cost}g at level ${level + 1}, but the tin holds ${state.gold}g.`,
    };
  }

  state.gold -= cost;
  state.upgrades[id] = level + 1;

  return { ok: true, id, level: level + 1, cost, effect: def.effect };
}

/** Everything investable, with what it would cost this farm right now. */
export function upgradeCatalogue(state: FarmState) {
  return (Object.keys(UPGRADES) as UpgradeId[]).map((id) => {
    const level = levelOf(state, id);
    return {
      id,
      name: UPGRADES[id].name,
      icon: UPGRADES[id].icon,
      effect: UPGRADES[id].effect,
      blurb: UPGRADES[id].blurb,
      level,
      maxLevel: maxLevel(id),
      nextCost: costOfNextLevel(id, level),
      owned: level > 0,
    };
  });
}
