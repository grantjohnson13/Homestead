/**
 * Animal husbandry. Animals never die and never leave — the worst that happens
 * is a grumpy hen who skips a morning. Cozy game, gentle stakes.
 */

import type { AnimalGoodId } from "./items.ts";

export const ANIMAL_KINDS = ["chicken", "cow"] as const;
export type AnimalKind = (typeof ANIMAL_KINDS)[number];

export interface AnimalDef {
  kind: AnimalKind;
  name: string;
  /** Purchase price at the supply shop. */
  cost: number;
  /** What it produces. */
  produces: AnimalGoodId;
  /** Game-minutes of *fed* time between productions. */
  produceEveryMinutes: number;
  /** How many of this kind the farm can house. */
  capacity: number;
  /** Units of feed consumed by one feeding. */
  feedPerServing: number;
  /** Game-minutes one serving of feed lasts. */
  feedLastsMinutes: number;
  blurb: string;
}

export const ANIMALS: Record<AnimalKind, AnimalDef> = {
  chicken: {
    kind: "chicken",
    name: "Chicken",
    cost: 100,
    produces: "egg",
    produceEveryMinutes: 40,
    capacity: 6,
    feedPerServing: 1,
    feedLastsMinutes: 120,
    blurb: "Cheap, cheerful, and lays an egg every 40 minutes if she's been fed.",
  },
  cow: {
    kind: "cow",
    name: "Cow",
    cost: 400,
    produces: "milk",
    produceEveryMinutes: 60,
    capacity: 3,
    feedPerServing: 2,
    feedLastsMinutes: 120,
    blurb: "A serious investment that pays a serious dividend in milk.",
  },
};

/** Mood bands. Mood is stored 0–100; these are the labels and their effects. */
export const MOOD_BANDS = [
  { min: 67, mood: "happy", skipChance: 0, label: "happy" },
  { min: 34, mood: "content", skipChance: 0.1, label: "content" },
  { min: 0, mood: "grumpy", skipChance: 0.35, label: "grumpy" },
] as const;

export type Mood = (typeof MOOD_BANDS)[number]["mood"];

export function moodFor(value: number): Mood {
  for (const band of MOOD_BANDS) {
    if (value >= band.min) return band.mood;
  }
  return "grumpy";
}

export function skipChanceFor(value: number): number {
  for (const band of MOOD_BANDS) {
    if (value >= band.min) return band.skipChance;
  }
  return 0.35;
}

/** Mood drifts down while hungry, up while fed. Points per game-minute. */
export const MOOD_DECAY_PER_MIN = 0.35;
export const MOOD_RECOVER_PER_MIN = 0.2;
/** A petting session is an instant mood boost. */
export const PET_MOOD_BOOST = 25;
export const STARTING_MOOD = 70;

/** Cute default names, handed out in order and then recycled with numbers. */
export const CHICKEN_NAMES = [
  "Nugget",
  "Pip",
  "Marigold",
  "Dumpling",
  "Clementine",
  "Biscuit",
  "Poppy",
  "Waffle",
];

export const COW_NAMES = ["Buttercup", "Clover", "Moonbeam", "Hazel", "Juniper", "Custard"];

export function defaultAnimalName(kind: AnimalKind, index: number): string {
  const pool = kind === "chicken" ? CHICKEN_NAMES : COW_NAMES;
  const base = pool[index % pool.length] as string;
  const round = Math.floor(index / pool.length);
  return round === 0 ? base : `${base} ${round + 1}`;
}
