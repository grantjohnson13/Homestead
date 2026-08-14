import { describe, expect, it } from "vitest";
import { ANIMALS, MOOD_DECAY_PER_MIN } from "../../src/data/animals.ts";
import {
  addAnimal,
  advance,
  animalCapacityLeft,
  countItem,
  isFed,
  minutesToProduce,
  moodLabel,
  petAnimal,
} from "../../src/sim/index.ts";
import { assignOrThrow, isIdle, makeFarm } from "./helpers.ts";

function runUntilIdle(state: ReturnType<typeof makeFarm>, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && !isIdle(state); i++) advance(state, 1);
}

describe("animals: feeding and production", () => {
  it("starts a new farm with one chicken", () => {
    const farm = makeFarm();
    expect(farm.animals).toHaveLength(1);
    expect(farm.animals[0]?.kind).toBe("chicken");
  });

  it("produces nothing while unfed", () => {
    const farm = makeFarm();
    advance(farm, 200);
    expect(farm.animals[0]?.pending).toBe(0);
    expect(countItem(farm.inventory, "egg")).toBe(0);
  });

  it("lays an egg on schedule once fed", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.fedUntil = 1000;
    chicken.mood = 100; // happy animals never skip

    advance(farm, ANIMALS.chicken.produceEveryMinutes);
    expect(chicken.pending).toBe(1);
  });

  it("keeps produce with the animal until it is collected", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.fedUntil = 1000;
    chicken.mood = 100;

    advance(farm, ANIMALS.chicken.produceEveryMinutes);
    expect(countItem(farm.inventory, "egg")).toBe(0);

    assignOrThrow(farm, [{ type: "collect", target: "all_chickens" }]);
    runUntilIdle(farm);
    expect(countItem(farm.inventory, "egg")).toBe(1);
    expect(chicken.pending).toBe(0);
  });

  it("feeds animals from barn stock and marks them fed", () => {
    const farm = makeFarm();
    const before = countItem(farm.inventory, "feed");

    assignOrThrow(farm, [{ type: "feed", target: "all_chickens" }]);
    runUntilIdle(farm);

    const chicken = farm.animals[0];
    expect(chicken && isFed(chicken, farm.clock)).toBe(true);
    expect(countItem(farm.inventory, "feed")).toBe(before - ANIMALS.chicken.feedPerServing);
  });

  it("stops counting as fed once the feed wears off", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.fedUntil = 10;

    advance(farm, 5);
    expect(isFed(chicken, farm.clock)).toBe(true);
    advance(farm, 10);
    expect(isFed(chicken, farm.clock)).toBe(false);
  });

  it("charges a cow more feed than a chicken", () => {
    expect(ANIMALS.cow.feedPerServing).toBeGreaterThan(ANIMALS.chicken.feedPerServing);
  });

  it("produces milk from cows", () => {
    const farm = makeFarm();
    const cow = addAnimal(farm, "cow");
    cow.fedUntil = 5000;
    cow.mood = 100;

    advance(farm, ANIMALS.cow.produceEveryMinutes);
    expect(cow.pending).toBe(1);

    assignOrThrow(farm, [{ type: "collect", target: "all_cows" }]);
    runUntilIdle(farm);
    expect(countItem(farm.inventory, "milk")).toBe(1);
  });

  it("reports minutes until the next production, or null when hungry", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");

    expect(minutesToProduce(chicken, farm.clock)).toBeNull();
    chicken.fedUntil = 1000;
    expect(minutesToProduce(chicken, farm.clock)).toBe(ANIMALS.chicken.produceEveryMinutes);
  });
});

describe("animals: mood", () => {
  it("slides from happy toward grumpy while hungry", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    expect(moodLabel(chicken)).toBe("happy");

    advance(farm, 200);
    expect(chicken.mood).toBeLessThan(50);
    expect(moodLabel(chicken)).toBe("grumpy");
  });

  it("decays at the documented rate", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    const before = chicken.mood;

    advance(farm, 10);
    expect(before - chicken.mood).toBeCloseTo(MOOD_DECAY_PER_MIN * 10, 5);
  });

  it("recovers while fed", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.mood = 20;
    chicken.fedUntil = 5000;

    advance(farm, 50);
    expect(chicken.mood).toBeGreaterThan(20);
  });

  it("jumps when petted", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.mood = 30;
    petAnimal(chicken);
    expect(chicken.mood).toBeGreaterThan(30);
  });

  it("lets a pet task lift a grumpy animal's mood", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.mood = 10;

    assignOrThrow(farm, [{ type: "pet", target: "all_chickens" }]);
    runUntilIdle(farm);
    expect(chicken.mood).toBeGreaterThan(10);
  });

  it("makes grumpy animals skip production sometimes", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.fedUntil = 100000;
    chicken.mood = 0; // grumpy: 35% skip chance

    // Count skips as they are logged: the event log is a rolling window and
    // would otherwise have scrolled these away by the end of the run.
    let skips = 0;
    for (let cycle = 0; cycle < 40; cycle++) {
      const before = farm.events.length;
      advance(farm, ANIMALS.chicken.produceEveryMinutes);
      skips += farm.events.slice(before).filter((e) => e.text.includes("skipped")).length;
    }

    const produced = chicken.pending;
    // 40 cycles at a 35% skip rate should land well under a perfect 40.
    expect(produced).toBeLessThan(40);
    expect(produced).toBeGreaterThan(10);
    expect(skips).toBeGreaterThan(0);
    expect(produced + skips).toBe(40);
  });

  it("never lets a happy animal skip", () => {
    const farm = makeFarm();
    const chicken = farm.animals[0];
    if (!chicken) throw new Error("no chicken");
    chicken.fedUntil = 100000;
    chicken.mood = 100;

    advance(farm, ANIMALS.chicken.produceEveryMinutes * 10);
    expect(chicken.pending).toBe(10);
  });

  it("never lets an animal die or leave", () => {
    const farm = makeFarm();
    advance(farm, 2000);
    expect(farm.animals).toHaveLength(1);
    expect(farm.animals[0]?.mood).toBeGreaterThanOrEqual(0);
  });
});

describe("animals: housing", () => {
  it("caps chickens at coop capacity", () => {
    const farm = makeFarm();
    expect(animalCapacityLeft(farm, "chicken")).toBe(ANIMALS.chicken.capacity - 1);
    for (let i = 1; i < ANIMALS.chicken.capacity; i++) addAnimal(farm, "chicken");
    expect(animalCapacityLeft(farm, "chicken")).toBe(0);
  });

  it("caps cows at barn capacity", () => {
    const farm = makeFarm();
    expect(animalCapacityLeft(farm, "cow")).toBe(ANIMALS.cow.capacity);
  });

  it("gives every animal a distinct cute name", () => {
    const farm = makeFarm();
    for (let i = 1; i < ANIMALS.chicken.capacity; i++) addAnimal(farm, "chicken");
    const names = farm.animals.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
