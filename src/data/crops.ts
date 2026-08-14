/**
 * Crop economics. Tuned in M6 — see DECISIONS.md for the balance pass.
 *
 * Growth model (see DECISIONS.md "crop growth"): a crop needs `growMinutes` of
 * *watered* time to become harvestable. Watering tops the plot's moisture up to
 * one "segment" (`growMinutes / waterNeeds`). Growth accrues only while moisture
 * remains, so a crop with `waterNeeds: 3` must be watered three times, spread
 * across its life, to finish on schedule. An unwatered crop stalls; it never dies.
 */

export const CROP_IDS = ["radish", "lettuce", "tomato", "corn", "strawberry", "pumpkin"] as const;

export type CropId = (typeof CROP_IDS)[number];

export interface CropDef {
  id: CropId;
  name: string;
  /** Cost of one seed at the supply shop, in gold. */
  seedCost: number;
  /** Watered game-minutes required to reach harvestable. */
  growMinutes: number;
  /** How many waterings that grow time is divided into. */
  waterNeeds: number;
  /** Base price one unit of produce sells for. */
  sellPrice: number;
  /** Units produced per harvest, inclusive range. */
  yield: [min: number, max: number];
  /**
   * Total number of harvests before the plant is spent and the plot returns to
   * tilled. 1 = single harvest. >1 = the plant regrows after each harvest.
   */
  harvests: number;
  /** Fraction of growMinutes needed to regrow between multi-harvests. */
  regrowFraction: number;
  /** One-line flavour, surfaced by get_almanac. */
  blurb: string;
}

export const CROPS: Record<CropId, CropDef> = {
  radish: {
    id: "radish",
    name: "Radish",
    seedCost: 10,
    growMinutes: 20,
    waterNeeds: 1,
    sellPrice: 25,
    yield: [1, 1],
    harvests: 1,
    regrowFraction: 0,
    blurb: "Fast, cheap, forgiving. The crop you plant while deciding what to plant.",
  },
  lettuce: {
    id: "lettuce",
    name: "Lettuce",
    seedCost: 15,
    growMinutes: 35,
    waterNeeds: 2,
    sellPrice: 40,
    yield: [1, 1],
    harvests: 1,
    regrowFraction: 0,
    blurb: "Thirstier than a radish, and twice as smug about it.",
  },
  tomato: {
    id: "tomato",
    name: "Tomato",
    seedCost: 30,
    growMinutes: 60,
    waterNeeds: 3,
    sellPrice: 45,
    yield: [2, 3],
    harvests: 2,
    regrowFraction: 0.5,
    blurb: "Bears twice. Worth the trellis and the trouble.",
  },
  corn: {
    id: "corn",
    name: "Corn",
    seedCost: 40,
    growMinutes: 90,
    waterNeeds: 3,
    sellPrice: 60,
    yield: [2, 2],
    harvests: 1,
    regrowFraction: 0,
    blurb: "Tall, patient, and reliably profitable.",
  },
  strawberry: {
    id: "strawberry",
    name: "Strawberry",
    seedCost: 60,
    growMinutes: 75,
    waterNeeds: 4,
    sellPrice: 55,
    yield: [2, 4],
    harvests: 3,
    regrowFraction: 0.45,
    blurb: "High upkeep, three harvests, and the customers adore them.",
  },
  pumpkin: {
    id: "pumpkin",
    name: "Pumpkin",
    seedCost: 80,
    growMinutes: 150,
    waterNeeds: 5,
    sellPrice: 220,
    yield: [1, 1],
    harvests: 1,
    regrowFraction: 0,
    blurb: "A long, thirsty gamble that pays for the whole month.",
  },
};

export function isCropId(value: string): value is CropId {
  return (CROP_IDS as readonly string[]).includes(value);
}

/** Watered minutes one watering buys for this crop. */
export function moistureSegment(crop: CropDef): number {
  return crop.growMinutes / crop.waterNeeds;
}

/** Growth stage shown in the UI, derived from progress toward harvestable. */
export const GROWTH_STAGES = ["seed", "sprout", "growing", "mature"] as const;
export type GrowthStage = (typeof GROWTH_STAGES)[number];

export function stageForProgress(progress: number, growMinutes: number): GrowthStage {
  if (growMinutes <= 0) return "mature";
  const f = progress / growMinutes;
  if (f >= 1) return "mature";
  if (f >= 0.55) return "growing";
  if (f >= 0.25) return "sprout";
  return "seed";
}
