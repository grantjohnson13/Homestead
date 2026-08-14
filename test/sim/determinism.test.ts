import { describe, expect, it } from "vitest";
import { OFFLINE_CAP_REAL_MS, REAL_MS_PER_TICK } from "../../src/sim/constants.ts";

/** The away budget expressed in game-minutes at normal speed. */
const CAP_MINUTES = OFFLINE_CAP_REAL_MS / REAL_MS_PER_TICK;
import {
  advance,
  catchUp,
  chance,
  createFarm,
  poissonInterval,
  randInt,
} from "../../src/sim/index.ts";
import { assignOrThrow, makeFarm } from "./helpers.ts";

/**
 * The whole engine's contract: same seed + same inputs => same farm. Everything
 * else (persistence, alarms, replay) depends on this holding.
 */
describe("determinism", () => {
  it("produces identical farms from identical inputs", () => {
    const a = createFarm(99, 0);
    const b = createFarm(99, 0);
    advance(a, 300);
    advance(b, 300);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces different farms from different seeds", () => {
    const a = createFarm(1, 0);
    const b = createFarm(2, 0);
    advance(a, 300);
    advance(b, 300);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("does not care how time is chunked", () => {
    const oneGo = createFarm(7, 0);
    const inSteps = createFarm(7, 0);

    advance(oneGo, 120);
    for (let i = 0; i < 24; i++) advance(inSteps, 5);

    expect(JSON.stringify(oneGo)).toBe(JSON.stringify(inSteps));
  });

  it("replays task execution identically", () => {
    const a = makeFarm(42);
    const b = makeFarm(42);
    for (const farm of [a, b]) {
      assignOrThrow(farm, [
        { type: "till", target: "plot_1" },
        { type: "plant", target: "plot_1", crop: "radish" },
        { type: "water", target: "plot_1" },
        { type: "harvest", target: "plot_1" },
      ]);
      advance(farm, 200);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("advances the cursor on every draw", () => {
    const farm = makeFarm();
    const start = farm.rngCursor;
    randInt(farm, 1, 6);
    chance(farm, 0.5);
    poissonInterval(farm, 8);
    expect(farm.rngCursor).toBe(start + 3);
  });

  it("keeps random draws inside their bounds", () => {
    const farm = makeFarm();
    for (let i = 0; i < 2000; i++) {
      const value = randInt(farm, 3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it("spreads randInt across its whole range", () => {
    const farm = makeFarm();
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(randInt(farm, 1, 6));
    expect(seen.size).toBe(6);
  });

  it("keeps Poisson intervals positive and bounded", () => {
    const farm = makeFarm();
    for (let i = 0; i < 1000; i++) {
      const interval = poissonInterval(farm, 8);
      expect(interval).toBeGreaterThanOrEqual(1);
      expect(interval).toBeLessThanOrEqual(24);
    }
  });

  it("round-trips through JSON unchanged", () => {
    const farm = makeFarm();
    advance(farm, 150);
    const restored = JSON.parse(JSON.stringify(farm));
    advance(farm, 50);
    advance(restored, 50);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(farm));
  });
});

describe("offline catch-up", () => {
  it("does nothing when no time has passed", () => {
    const farm = createFarm(5, 1000);
    const result = catchUp(farm, 1000);
    expect(result.simulated).toBe(0);
    expect(farm.clock).toBe(0);
  });

  it("simulates one game-minute per real second", () => {
    const farm = createFarm(5, 0);
    const result = catchUp(farm, 30 * REAL_MS_PER_TICK);
    expect(result.simulated).toBe(30);
    expect(farm.clock).toBe(30);
  });

  it("caps simulated time at two game-hours", () => {
    const farm = createFarm(5, 0);
    const result = catchUp(farm, 10_000 * REAL_MS_PER_TICK);

    expect(result.simulated).toBe(CAP_MINUTES);
    expect(result.skipped).toBe(10_000 - CAP_MINUTES);
    expect(farm.clock).toBe(CAP_MINUTES);
    expect(farm.paused).toBe(true);
  });

  it("writes a while-you-were-away summary", () => {
    const farm = createFarm(5, 0);
    const result = catchUp(farm, 90 * REAL_MS_PER_TICK);

    expect(result.summary).toBeTypeOf("string");
    expect(result.summary).toContain("While you were away");
    expect(farm.awaySummary).toBe(result.summary);
  });

  it("stays quiet about very short gaps", () => {
    const farm = createFarm(5, 0);
    const result = catchUp(farm, 2 * REAL_MS_PER_TICK);
    expect(result.summary).toBeNull();
  });

  it("mentions the unsimulated remainder when the cap bites", () => {
    const farm = createFarm(5, 0);
    const result = catchUp(farm, 500 * REAL_MS_PER_TICK);
    expect(result.summary).toContain("unsimulated");
  });

  it("leaves the farm playable after a long absence", () => {
    const farm = createFarm(5, 0);
    catchUp(farm, 100_000 * REAL_MS_PER_TICK);

    expect(farm.gold).toBeGreaterThanOrEqual(0);
    expect(farm.reputation).toBeGreaterThanOrEqual(0);
    expect(farm.animals).toHaveLength(1);
    expect(farm.customers.length).toBeLessThanOrEqual(4);
  });
});
