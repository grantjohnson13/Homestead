import { describe, expect, it } from "vitest";
import { CROPS, CROP_IDS } from "../../src/data/crops.ts";
import { REPUTATION, STAMINA } from "../../src/sim/constants.ts";
import {
  advance,
  buySupplies,
  createFarm,
  findPath,
  nextId,
  randInt,
  sellToCustomer,
  setPrices,
  validateBatch,
  type FarmState,
  type TaskInput,
} from "../../src/sim/index.ts";
import { PLOT_TILES, isWalkable, tileAt } from "../../src/data/map.ts";

/**
 * Property tests: instead of asserting one scripted outcome, these hammer the
 * engine with randomised input and assert the invariants that must hold for
 * *every* farm, in every state. This is where a rule that is only accidentally
 * true shows up.
 */

const RUNS = 60;

/** A cheap deterministic generator, independent of the sim's own RNG. */
function makeGen(seed: number) {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    int(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    pick<T>(items: readonly T[]): T {
      return items[this.int(0, items.length - 1)] as T;
    },
  };
}

type Gen = ReturnType<typeof makeGen>;

/** Builds a random but legal-ish batch of work. */
function randomTasks(gen: Gen, count: number): TaskInput[] {
  const types = ["till", "plant", "water", "harvest", "feed", "collect", "restock", "pet", "idle"];
  const tasks: TaskInput[] = [];
  for (let i = 0; i < count; i++) {
    const type = gen.pick(types);
    const plot = `plot_${gen.int(1, 12)}`;
    if (type === "plant") tasks.push({ type, target: plot, crop: gen.pick(CROP_IDS) });
    else if (type === "feed" || type === "pet" || type === "collect") {
      tasks.push({ type, target: gen.pick(["all_chickens", "all_cows", "all_animals"]) });
    } else if (type === "restock") tasks.push({ type, target: "all" });
    else if (type === "idle") tasks.push({ type });
    else tasks.push({ type, target: plot });
  }
  return tasks;
}

/** Plays a farm through random work and random purchases. */
function chaosRun(seed: number, ticks: number): FarmState {
  const gen = makeGen(seed);
  const farm = createFarm(seed, 0);

  for (let tick = 0; tick < ticks; tick++) {
    if (gen.next() < 0.08) {
      const verdicts = validateBatch(farm, randomTasks(gen, gen.int(1, 6)), () =>
        nextId(farm, "task"),
      );
      for (const verdict of verdicts) {
        if (verdict.accepted && verdict.task) farm.wren.queue.push(verdict.task);
      }
    }
    if (gen.next() < 0.03) {
      buySupplies(
        farm,
        gen.pick(["radish_seed", "tomato_seed", "feed", "chicken", "cow", "not_a_thing"]),
        gen.int(1, 5),
      );
    }
    // Randomly re-price the whole stand, and occasionally force a hand-sale.
    if (gen.next() < 0.04) {
      const good = gen.pick(["radish", "tomato", "egg", "milk", "pumpkin", "not_a_good"]);
      setPrices(farm, { [good]: gen.int(1, 400) });
    }
    if (gen.next() < 0.1 && farm.customers.length > 0) {
      const customer = gen.pick(farm.customers);
      const price = gen.next() < 0.5 ? undefined : gen.int(1, 500);
      sellToCustomer(farm, customer.id, price);
    }
    advance(farm, 1);
  }

  return farm;
}

describe("invariants under random play", () => {
  it("never lets gold go negative", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      expect(farm.gold, `seed ${seed}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps reputation inside its bounds", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      expect(farm.reputation, `seed ${seed}`).toBeGreaterThanOrEqual(REPUTATION.min);
      expect(farm.reputation, `seed ${seed}`).toBeLessThanOrEqual(REPUTATION.max);
    }
  });

  it("keeps stamina inside its bounds", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      expect(farm.wren.stamina, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(farm.wren.stamina, `seed ${seed}`).toBeLessThanOrEqual(STAMINA.max);
    }
  });

  it("never leaves Wren standing somewhere she cannot stand", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      expect(isWalkable(farm.wren.x, farm.wren.y), `seed ${seed}`).toBe(true);
    }
  });

  it("never lets a plot hold more progress than its crop needs", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      for (const plot of farm.plots) {
        if (!plot.crop) continue;
        expect(plot.progress, `${plot.id} @ seed ${seed}`).toBeLessThanOrEqual(
          CROPS[plot.crop].growMinutes,
        );
        expect(plot.progress).toBeGreaterThanOrEqual(0);
        expect(plot.moisture).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("never lets a plot be both empty and planted", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      for (const plot of farm.plots) {
        if (plot.crop) expect(plot.tilled, `${plot.id} @ seed ${seed}`).toBe(false);
        expect(plot.harvestsDone).toBeLessThan(
          plot.crop ? CROPS[plot.crop].harvests + 1 : Number.POSITIVE_INFINITY,
        );
      }
    }
  });

  it("never lets inventory counts go negative", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      for (const bag of [farm.inventory, farm.stand]) {
        for (const [id, qty] of Object.entries(bag)) {
          expect(qty, `${id} @ seed ${seed}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never exceeds animal housing", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      expect(farm.animals.filter((a) => a.kind === "chicken").length).toBeLessThanOrEqual(6);
      expect(farm.animals.filter((a) => a.kind === "cow").length).toBeLessThanOrEqual(3);
    }
  });

  it("keeps animal mood inside its bounds", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      for (const animal of farm.animals) {
        expect(animal.mood).toBeGreaterThanOrEqual(0);
        expect(animal.mood).toBeLessThanOrEqual(100);
        expect(animal.pending).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps the customer queue within its cap and always fed by real profiles", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const farm = chaosRun(seed, 200);
      expect(farm.customers.length).toBeLessThanOrEqual(4);
      for (const customer of farm.customers) {
        expect(customer.wants.length).toBeGreaterThan(0);
        expect(customer.maxPrice).toBeGreaterThan(0);
        for (const want of customer.wants) expect(want.qty).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the clock exactly in step with the ticks simulated", () => {
    for (let seed = 0; seed < 20; seed++) {
      const farm = chaosRun(seed, 137);
      expect(farm.clock, `seed ${seed}`).toBe(137);
    }
  });

  it("stays JSON round-trippable at every point", () => {
    for (let seed = 0; seed < 20; seed++) {
      const farm = chaosRun(seed, 120);
      const restored = JSON.parse(JSON.stringify(farm)) as FarmState;
      advance(farm, 40);
      advance(restored, 40);
      expect(JSON.stringify(restored), `seed ${seed}`).toBe(JSON.stringify(farm));
    }
  });
});

describe("determinism as a property", () => {
  it("gives identical farms for identical seeds, whatever the play", () => {
    for (let seed = 0; seed < 25; seed++) {
      const a = chaosRun(seed, 150);
      const b = chaosRun(seed, 150);
      expect(JSON.stringify(a), `seed ${seed}`).toBe(JSON.stringify(b));
    }
  });

  it("does not depend on how the elapsed time is chunked", () => {
    for (let seed = 0; seed < 15; seed++) {
      const whole = createFarm(seed, 0);
      const split = createFarm(seed, 0);

      advance(whole, 90);
      const gen = makeGen(seed + 5000);
      let done = 0;
      while (done < 90) {
        const step = Math.min(gen.int(1, 11), 90 - done);
        advance(split, step);
        done += step;
      }

      expect(JSON.stringify(split), `seed ${seed}`).toBe(JSON.stringify(whole));
    }
  });
});

describe("pathfinding as a property", () => {
  it("finds a contiguous walkable route between any two walkable tiles", () => {
    const walkable = [];
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        if (isWalkable(x, y)) walkable.push({ x, y });
      }
    }

    const gen = makeGen(4242);
    for (let i = 0; i < 400; i++) {
      const from = gen.pick(walkable);
      const to = gen.pick(walkable);
      const path = findPath(from, to);

      expect(path, `${from.x},${from.y} -> ${to.x},${to.y}`).not.toBeNull();
      const steps = path as { x: number; y: number }[];

      let cursor = from;
      for (const step of steps) {
        expect(Math.abs(step.x - cursor.x) + Math.abs(step.y - cursor.y)).toBe(1);
        expect(isWalkable(step.x, step.y)).toBe(true);
        cursor = step;
      }
      expect(cursor).toEqual(to);
    }
  });

  it("never routes to an unwalkable tile", () => {
    const blocked = [];
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        if (!isWalkable(x, y)) blocked.push({ x, y });
      }
    }
    expect(blocked.length).toBeGreaterThan(0);

    for (const target of blocked) {
      expect(findPath({ x: 2, y: 3 }, target), `${target.x},${target.y}`).toBeNull();
    }
  });

  it("returns paths no longer than the grid could possibly require", () => {
    const gen = makeGen(99);
    for (let i = 0; i < 200; i++) {
      const tile = gen.pick(PLOT_TILES);
      const path = findPath({ x: 2, y: 3 }, { x: tile.x, y: tile.y });
      expect(path).not.toBeNull();
      expect((path as unknown[]).length).toBeLessThan(16 * 12);
    }
  });

  it("agrees with the map about what a tile is", () => {
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        const tile = tileAt(x, y);
        expect(isWalkable(x, y)).toBe(tile?.walkable ?? false);
      }
    }
  });
});

describe("random draws stay in range", () => {
  it("keeps randInt within its bounds for arbitrary ranges", () => {
    const gen = makeGen(7);
    const farm = createFarm(3, 0);
    for (let i = 0; i < 3000; i++) {
      const min = gen.int(-50, 50);
      const max = min + gen.int(0, 60);
      const value = randInt(farm, min, max);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
