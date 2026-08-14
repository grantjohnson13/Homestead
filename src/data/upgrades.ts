/**
 * Things you can invest in.
 *
 * Upgrades are the long game: gold you take out of circulation now to loosen a
 * constraint later. They deliberately attack the three real bottlenecks rather
 * than just adding numbers —
 *
 *   1. Wren's time      (watering can, wheelbarrow, sprinklers)
 *   2. Customer flow    (market stall, signboard, fine stand)
 *   3. Housing          (coop and barn extensions)
 *
 * Customer throughput is the binding constraint on a farm's income, so the
 * stand upgrades are the expensive ones and the ones that change the game most.
 */

export const UPGRADE_IDS = [
  "watering_can",
  "wheelbarrow",
  "sprinklers",
  "market_stall",
  "signboard",
  "fine_stand",
  "coop_extension",
  "barn_extension",
] as const;

export type UpgradeId = (typeof UPGRADE_IDS)[number];

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** Cost of each successive level, in gold. Length is the max level. */
  costs: readonly number[];
  /** Sprite id in the farm view's icon set. */
  icon: string;
  /** What it does, in one line, for the almanac and the UI. */
  effect: string;
  blurb: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  watering_can: {
    id: "watering_can",
    name: "Bigger watering can",
    costs: [150, 400],
    icon: "ic-can",
    effect: "+4 waterings per trip to the well",
    blurb: "Fewer walks to the well means more of the day spent actually farming.",
  },
  wheelbarrow: {
    id: "wheelbarrow",
    name: "Wheelbarrow",
    costs: [180, 460],
    icon: "ic-box",
    effect: "+8 goods carried per restock trip",
    blurb: "One trip to the stand instead of three.",
  },
  sprinklers: {
    id: "sprinklers",
    name: "Sprinklers",
    costs: [350, 900],
    icon: "ic-sprinkler",
    effect: "each watering lasts 30% longer",
    blurb: "Crops stay damp while Wren is busy elsewhere.",
  },
  market_stall: {
    id: "market_stall",
    name: "Bigger market stall",
    costs: [320, 820],
    icon: "ic-stall",
    effect: "customers arrive 18% more often",
    blurb: "Word spreads. More people make the walk out to your gate.",
  },
  signboard: {
    id: "signboard",
    name: "Roadside signboard",
    costs: [240, 620],
    icon: "ic-sign",
    effect: "customers wait 35% longer",
    blurb: "They can see what you have from the lane, so they linger.",
  },
  fine_stand: {
    id: "fine_stand",
    name: "Handsome stand",
    costs: [520, 1300],
    icon: "ic-awning",
    effect: "customers pay 12% more",
    blurb: "A stand that looks like it sells good things can charge like it too.",
  },
  coop_extension: {
    id: "coop_extension",
    name: "Coop extension",
    costs: [300, 720],
    icon: "a-chicken",
    effect: "+2 chicken places",
    blurb: "Room for a few more hens, and the noise that comes with them.",
  },
  barn_extension: {
    id: "barn_extension",
    name: "Barn extension",
    costs: [620, 1450],
    icon: "a-cow",
    effect: "+1 cow stall",
    blurb: "Cows are an expensive habit. Here is somewhere to keep another.",
  },
};

/** Per-level effect sizes, kept here so the balance pass has one place to edit. */
export const UPGRADE_EFFECTS = {
  waterCanPerLevel: 4,
  carryPerLevel: 8,
  moisturePerLevel: 0.3,
  arrivalSpeedPerLevel: 0.18,
  patiencePerLevel: 0.35,
  willingnessPerLevel: 0.12,
  chickenPlacesPerLevel: 2,
  cowPlacesPerLevel: 1,
} as const;

export function maxLevel(id: UpgradeId): number {
  return UPGRADES[id].costs.length;
}

/** Cost of moving from `level` to `level + 1`, or null if fully upgraded. */
export function costOfNextLevel(id: UpgradeId, level: number): number | null {
  const costs = UPGRADES[id].costs;
  return level < costs.length ? (costs[level] as number) : null;
}

export function isUpgradeId(value: string): value is UpgradeId {
  return (UPGRADE_IDS as readonly string[]).includes(value);
}
