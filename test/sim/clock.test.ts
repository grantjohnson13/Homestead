import { describe, expect, it } from "vitest";
import { CUSTOMERS, REAL_MS_PER_TICK } from "../../src/sim/constants.ts";
import { DAY_START_HOUR, MINUTES_PER_DAY, farmTime } from "../../src/sim/index.ts";

describe("the farm day-clock", () => {
  it("starts a new farm at dawn on day one", () => {
    const time = farmTime(0);
    expect(time.day).toBe(1);
    expect(time.hour).toBe(DAY_START_HOUR);
    expect(time.minute).toBe(0);
    expect(time.label).toBe("Day 1 · 06:00");
  });

  it("advances a minute per game-minute", () => {
    expect(farmTime(125).label).toBe("Day 1 · 08:05");
    expect(farmTime(60).label).toBe("Day 1 · 07:00");
  });

  it("rolls over to the next day", () => {
    // 18 hours from a 6am start lands on midnight.
    expect(farmTime(18 * 60).label).toBe("Day 2 · 00:00");
    expect(farmTime(MINUTES_PER_DAY).day).toBe(2);
    expect(farmTime(MINUTES_PER_DAY * 3).day).toBe(4);
  });

  it("pads to a readable clock face", () => {
    expect(farmTime(3 * 60 + 5).label).toBe("Day 1 · 09:05");
    expect(farmTime(4 * 60).label).toBe("Day 1 · 10:00");
  });

  it("names the part of the day", () => {
    expect(farmTime(0).partOfDay).toBe("dawn");
    expect(farmTime(4 * 60).partOfDay).toBe("morning");
    expect(farmTime(8 * 60).partOfDay).toBe("afternoon");
    expect(farmTime(13 * 60).partOfDay).toBe("evening");
    expect(farmTime(17 * 60).partOfDay).toBe("night");
  });

  it("copes with a negative or fractional clock", () => {
    expect(farmTime(-50).label).toBe("Day 1 · 06:00");
    expect(farmTime(10.9).minute).toBe(10);
  });
});

/**
 * Customer timing is the one place where simulated time has to be measured
 * against a human reading a message and typing a reply. These assertions exist
 * because playtesting found the original numbers unplayable in a way no
 * simulation test could: the scripted players served customers in the same tick
 * they arrived, so patience never mattered.
 */
describe("customer timing is playable by a human", () => {
  const patienceRealSeconds = (CUSTOMERS.patienceMinutes * REAL_MS_PER_TICK) / 1000;
  const arrivalRealSeconds = (CUSTOMERS.baseIntervalMinutes * REAL_MS_PER_TICK) / 1000;

  it("gives a player long enough to actually respond", () => {
    // A conversational turn plus a restock trip. Anything under a minute means
    // customers expire before the player can finish reading about them.
    expect(patienceRealSeconds).toBeGreaterThanOrEqual(90);
  });

  it("does not make them wait so long that patience stops mattering", () => {
    expect(patienceRealSeconds).toBeLessThanOrEqual(300);
  });

  it("leaves room for Wren to restock the stand before they give up", () => {
    // A barn-to-stand round trip is on the order of 30 game-minutes including
    // walking; patience must comfortably exceed that.
    expect(CUSTOMERS.patienceMinutes).toBeGreaterThan(30 * 2);
  });

  it("spaces arrivals to roughly one per conversational turn", () => {
    expect(arrivalRealSeconds).toBeGreaterThanOrEqual(20);
    expect(arrivalRealSeconds).toBeLessThanOrEqual(120);
  });

  it("keeps the stand from permanently sitting at the cap", () => {
    // Expected queue length is patience / interval; it must stay under the cap
    // or every arrival is wasted and reputation only ever falls.
    const expectedQueue = CUSTOMERS.patienceMinutes / CUSTOMERS.baseIntervalMinutes;
    expect(expectedQueue).toBeLessThan(CUSTOMERS.maxWaiting);
  });
});
