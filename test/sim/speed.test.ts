import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEED,
  MAX_SPEED,
  MIN_SPEED,
  REAL_MS_PER_TICK,
  SPEED_OPTIONS,
  TICKS_PER_ALARM,
} from "../../src/sim/constants.ts";
import {
  advance,
  catchUp,
  createFarm,
  msUntilNextTick,
  setSpeed,
  speedOf,
} from "../../src/sim/index.ts";

describe("world speed", () => {
  it("starts at normal speed", () => {
    expect(speedOf(createFarm(1, 0))).toBe(DEFAULT_SPEED);
  });

  it("advances a game-minute per real second at 1x", () => {
    const farm = createFarm(1, 0);
    catchUp(farm, 30 * REAL_MS_PER_TICK);
    expect(farm.clock).toBe(30);
  });

  it("advances proportionally faster when sped up", () => {
    const farm = createFarm(1, 0);
    setSpeed(farm, 0, 4);
    catchUp(farm, 30 * REAL_MS_PER_TICK);
    expect(farm.clock).toBe(120);
  });

  it("advances proportionally slower when slowed down", () => {
    const farm = createFarm(1, 0);
    setSpeed(farm, 0, 0.5);
    catchUp(farm, 60 * REAL_MS_PER_TICK);
    expect(farm.clock).toBe(30);
  });

  it("does not lose the leftover fraction of a second", () => {
    // At half speed a one-second call earns no whole game-minute; without
    // carrying the remainder the clock would never advance at all.
    const farm = createFarm(1, 0);
    setSpeed(farm, 0, 0.5);

    for (let i = 1; i <= 10; i++) catchUp(farm, i * REAL_MS_PER_TICK);
    expect(farm.clock).toBe(5);
  });

  it("does not retroactively re-run elapsed time at the new speed", () => {
    const farm = createFarm(1, 0);
    // Ten real seconds pass at 1x...
    catchUp(farm, 10 * REAL_MS_PER_TICK);
    expect(farm.clock).toBe(10);

    // ...then the speed changes. Those ten seconds must stay worth ten minutes.
    setSpeed(farm, 10 * REAL_MS_PER_TICK, 4);
    expect(farm.clock).toBe(10);

    catchUp(farm, 15 * REAL_MS_PER_TICK);
    expect(farm.clock).toBe(30); // 10 + 5 real seconds at 4x
  });

  it("reports the change", () => {
    const farm = createFarm(1, 0);
    const result = setSpeed(farm, 0, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.from).toBe(1);
    expect(result.to).toBe(2);
  });

  it("rejects nonsense speeds", () => {
    const farm = createFarm(1, 0);
    expect(setSpeed(farm, 0, 0).ok).toBe(false);
    expect(setSpeed(farm, 0, -2).ok).toBe(false);
    expect(setSpeed(farm, 0, Number.NaN).ok).toBe(false);
    expect(setSpeed(farm, 0, MAX_SPEED + 1).ok).toBe(false);
    expect(setSpeed(farm, 0, MIN_SPEED / 2).ok).toBe(false);
    expect(speedOf(farm)).toBe(DEFAULT_SPEED);
  });

  it("accepts every advertised option", () => {
    for (const speed of SPEED_OPTIONS) {
      const farm = createFarm(1, 0);
      expect(setSpeed(farm, 0, speed).ok, String(speed)).toBe(true);
      expect(speedOf(farm)).toBe(speed);
    }
  });

  it("falls back to normal for a save with no speed at all", () => {
    const farm = createFarm(1, 0);
    delete (farm as unknown as Record<string, unknown>)["speed"];
    expect(speedOf(farm)).toBe(DEFAULT_SPEED);
  });

  it("clamps a corrupt speed instead of running away", () => {
    const farm = createFarm(1, 0);
    farm.speed = 10000;
    expect(speedOf(farm)).toBe(MAX_SPEED);
  });

  it("ticks the alarm more often as the world speeds up", () => {
    const farm = createFarm(1, 0);
    const normal = msUntilNextTick(farm, TICKS_PER_ALARM);

    setSpeed(farm, 0, 4);
    expect(msUntilNextTick(farm, TICKS_PER_ALARM)).toBeLessThan(normal);

    setSpeed(farm, 0, 0.5);
    expect(msUntilNextTick(farm, TICKS_PER_ALARM)).toBeGreaterThan(normal);
  });

  it("never schedules an alarm storm", () => {
    const farm = createFarm(1, 0);
    farm.speed = MAX_SPEED;
    expect(msUntilNextTick(farm, TICKS_PER_ALARM)).toBeGreaterThanOrEqual(250);
  });
});

describe("speed changes pace, not balance", () => {
  /**
   * The whole point of uniform scaling: a farm run for the same number of
   * *game*-minutes must end up identical whatever the speed setting. Only the
   * real time it took to get there differs.
   */
  it("produces an identical farm for the same game-minutes at any speed", () => {
    const slow = createFarm(4242, 0);
    const fast = createFarm(4242, 0);
    setSpeed(fast, 0, 8);

    advance(slow, 400);
    advance(fast, 400);

    // Speed itself is the only field expected to differ.
    slow.speed = fast.speed;
    expect(JSON.stringify(fast)).toBe(JSON.stringify(slow));
  });

  it("reaches the same farm via catch-up as via direct ticks", () => {
    const ticked = createFarm(77, 0);
    const caught = createFarm(77, 0);
    setSpeed(caught, 0, 4);

    // Kept under the offline cap, which bounds catch-up in game-minutes.
    advance(ticked, 100);
    catchUp(caught, 25 * REAL_MS_PER_TICK); // 25 real seconds at 4x

    expect(caught.clock).toBe(ticked.clock);

    // Compare the farm itself, not the catch-up bookkeeping (away budget, pause
    // flag, wall-clock marker), which only one of the two paths touches.
    const game = (farm: typeof ticked) =>
      JSON.stringify({
        clock: farm.clock,
        gold: farm.gold,
        reputation: farm.reputation,
        plots: farm.plots,
        animals: farm.animals,
        wren: farm.wren,
        customers: farm.customers,
        inventory: farm.inventory,
        stand: farm.stand,
        rngCursor: farm.rngCursor,
      });

    expect(game(caught)).toBe(game(ticked));
  });

  it("keeps the offline cap measured in game-minutes, not real ones", () => {
    const fast = createFarm(5, 0);
    setSpeed(fast, 0, 8);

    // A very long absence still only simulates the capped game-time.
    catchUp(fast, 10_000 * REAL_MS_PER_TICK);
    expect(fast.paused).toBe(true);
    expect(fast.clock).toBeLessThanOrEqual(120);
  });
});
