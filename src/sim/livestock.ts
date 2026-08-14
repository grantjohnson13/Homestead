/**
 * Animals: feeding, mood, and production.
 *
 * An animal only makes progress toward its next egg or bucket while it is fed.
 * Mood drifts down when hungry and up when fed, and a grumpy animal sometimes
 * skips a cycle — the gentlest possible punishment for neglect.
 */

import {
  ANIMALS,
  MOOD_DECAY_PER_MIN,
  MOOD_RECOVER_PER_MIN,
  PET_MOOD_BOOST,
  moodFor,
  skipChanceFor,
} from "../data/animals.ts";
import { describeGoodWithArticle } from "../data/items.ts";
import { logEvent } from "./farm.ts";
import { chance } from "./rng.ts";
import type { Animal, FarmState } from "./types.ts";

export function isFed(animal: Animal, clock: number): boolean {
  return animal.fedUntil > clock;
}

export function tickAnimals(state: FarmState): void {
  for (const animal of state.animals) {
    const def = ANIMALS[animal.kind];
    const fed = isFed(animal, state.clock);

    if (fed) {
      animal.mood = Math.min(100, animal.mood + MOOD_RECOVER_PER_MIN);
      animal.produceProgress += 1;

      if (animal.produceProgress >= def.produceEveryMinutes) {
        animal.produceProgress = 0;
        if (chance(state, skipChanceFor(animal.mood))) {
          logEvent(
            state,
            "animal",
            `${animal.name} is ${moodFor(animal.mood)} and skipped ${describeGoodWithArticle(def.produces)}.`,
          );
        } else {
          // Produce waits with the animal until a collect task fetches it.
          animal.pending += 1;
          logEvent(
            state,
            "animal",
            `${animal.name} has ${describeGoodWithArticle(def.produces)} ready to collect.`,
          );
        }
      }
    } else {
      const before = moodFor(animal.mood);
      animal.mood = Math.max(0, animal.mood - MOOD_DECAY_PER_MIN);
      const after = moodFor(animal.mood);
      if (before !== after) {
        logEvent(state, "animal", `${animal.name} is getting hungry and is now ${after}.`);
      }
    }
  }
}

/** Feeds one animal if there is feed for it. Returns whether it ate. */
export function feedAnimal(state: FarmState, animal: Animal, feedAvailable: number): number {
  const def = ANIMALS[animal.kind];
  if (feedAvailable < def.feedPerServing) return 0;
  animal.fedUntil = state.clock + def.feedLastsMinutes;
  animal.mood = Math.min(100, animal.mood + 8);
  return def.feedPerServing;
}

export function petAnimal(animal: Animal): void {
  animal.mood = Math.min(100, animal.mood + PET_MOOD_BOOST);
}

/** Human-readable mood label, for tool results and tooltips. */
export function moodLabel(animal: Animal): string {
  return moodFor(animal.mood);
}

/** Minutes until this animal's next production, or null if it is not fed. */
export function minutesToProduce(animal: Animal, clock: number): number | null {
  if (!isFed(animal, clock)) return null;
  const def = ANIMALS[animal.kind];
  return Math.max(0, Math.ceil(def.produceEveryMinutes - animal.produceProgress));
}
