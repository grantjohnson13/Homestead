import { describe, expect, it } from "vitest";
import { ANCHORS, PLOT_TILES, WREN_HOME, isWalkable, tileAt } from "../../src/data/map.ts";
import { facingFor, findPath, manhattan } from "../../src/sim/index.ts";

describe("pathfinding", () => {
  it("returns an empty path when already there", () => {
    expect(findPath(WREN_HOME, WREN_HOME)).toEqual([]);
  });

  it("finds a path from the farmhouse to every plot", () => {
    for (const tile of PLOT_TILES) {
      const path = findPath(WREN_HOME, { x: tile.x, y: tile.y });
      expect(path, tile.plotId).not.toBeNull();
      expect((path as { x: number; y: number }[]).length).toBeGreaterThan(0);
    }
  });

  it("finds a path between every pair of anchors", () => {
    const anchors = Object.values(ANCHORS);
    for (const from of anchors) {
      for (const to of anchors) {
        expect(findPath(from, to)).not.toBeNull();
      }
    }
  });

  it("produces a contiguous, walkable route", () => {
    const path = findPath(WREN_HOME, ANCHORS.stand);
    expect(path).not.toBeNull();
    const steps = path as { x: number; y: number }[];

    let cursor = WREN_HOME;
    for (const step of steps) {
      expect(manhattan(cursor, step)).toBe(1); // one tile at a time
      expect(isWalkable(step.x, step.y)).toBe(true);
      cursor = step;
    }
    expect(cursor).toEqual({ x: ANCHORS.stand.x, y: ANCHORS.stand.y });
  });

  it("returns the shortest route", () => {
    const path = findPath(WREN_HOME, ANCHORS.well) as { x: number; y: number }[];
    expect(path.length).toBeGreaterThanOrEqual(manhattan(WREN_HOME, ANCHORS.well));
    // The route between these two is unobstructed, so it should be exactly Manhattan.
    expect(path.length).toBe(manhattan(WREN_HOME, ANCHORS.well));
  });

  it("refuses to route into a building", () => {
    const barn = tileAt(12, 5);
    expect(barn?.walkable).toBe(false);
    expect(findPath(WREN_HOME, { x: 12, y: 5 })).toBeNull();
  });

  it("refuses to route off the map", () => {
    expect(findPath(WREN_HOME, { x: -1, y: 0 })).toBeNull();
    expect(findPath(WREN_HOME, { x: 99, y: 99 })).toBeNull();
  });

  it("derives facing from a step", () => {
    expect(facingFor({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe("right");
    expect(facingFor({ x: 1, y: 1 }, { x: 0, y: 1 })).toBe("left");
    expect(facingFor({ x: 1, y: 1 }, { x: 1, y: 2 })).toBe("down");
    expect(facingFor({ x: 1, y: 1 }, { x: 1, y: 0 })).toBe("up");
    expect(facingFor({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});
