import { describe, expect, it } from "vitest";
import {
  ANCHORS,
  CUSTOMER_SPOTS,
  MAP_HEIGHT,
  MAP_WIDTH,
  PLOT_IDS,
  PLOT_TILES,
  TILES,
  isWalkable,
  plotTile,
  tileAt,
} from "../src/data/map.ts";

/** Flood fill the walkable region from a starting point. */
function reachableFrom(start: { x: number; y: number }): Set<string> {
  const key = (x: number, y: number) => `${x},${y}`;
  const seen = new Set<string>([key(start.x, start.y)]);
  const queue = [start];
  while (queue.length > 0) {
    const p = queue.shift() as { x: number; y: number };
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!seen.has(key(nx, ny)) && isWalkable(nx, ny)) {
        seen.add(key(nx, ny));
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}

describe("farm map", () => {
  it("is 16x12", () => {
    expect(MAP_WIDTH).toBe(16);
    expect(MAP_HEIGHT).toBe(12);
    expect(TILES).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
  });

  it("has exactly 12 plots arranged in a 4x3 block", () => {
    expect(PLOT_TILES).toHaveLength(12);
    expect(PLOT_IDS[0]).toBe("plot_1");
    expect(PLOT_IDS[11]).toBe("plot_12");

    const xs = new Set(PLOT_TILES.map((t) => t.x));
    const ys = new Set(PLOT_TILES.map((t) => t.y));
    expect(xs.size).toBe(4);
    expect(ys.size).toBe(3);
  });

  it("numbers plots left-to-right, top-to-bottom", () => {
    const first = plotTile("plot_1");
    const fifth = plotTile("plot_5");
    expect(first).toBeDefined();
    expect(fifth).toBeDefined();
    // plot_5 starts the second row, so it is below and left of plot_4.
    expect((fifth as { y: number }).y).toBe((first as { y: number }).y + 1);
  });

  it("is bounded by fence on every edge", () => {
    for (let x = 0; x < MAP_WIDTH; x++) {
      expect(tileAt(x, 0)?.type).toBe("fence");
      expect(tileAt(x, MAP_HEIGHT - 1)?.type).toBe("fence");
    }
    for (let y = 0; y < MAP_HEIGHT; y++) {
      expect(tileAt(0, y)?.type).toBe("fence");
      expect(tileAt(MAP_WIDTH - 1, y)?.type).toBe("fence");
    }
  });

  it("keeps buildings, water and fence unwalkable", () => {
    for (const tile of TILES) {
      const shouldWalk = tile.type === "grass" || tile.type === "path" || tile.type === "plot";
      expect(tile.walkable).toBe(shouldWalk);
    }
  });

  it("has one fully connected walkable region", () => {
    const reachable = reachableFrom(ANCHORS.farmhouse);
    const walkable = TILES.filter((t) => t.walkable);
    expect(reachable.size).toBe(walkable.length);
  });

  it("lets Wren reach every anchor and every plot", () => {
    const reachable = reachableFrom(ANCHORS.farmhouse);
    for (const [name, point] of Object.entries(ANCHORS)) {
      expect(reachable.has(`${point.x},${point.y}`), `anchor ${name}`).toBe(true);
    }
    for (const tile of PLOT_TILES) {
      expect(reachable.has(`${tile.x},${tile.y}`), tile.plotId).toBe(true);
    }
  });

  it("puts customers on walkable tiles near the stand", () => {
    const reachable = reachableFrom(ANCHORS.farmhouse);
    for (const spot of CUSTOMER_SPOTS) {
      expect(isWalkable(spot.x, spot.y)).toBe(true);
      expect(reachable.has(`${spot.x},${spot.y}`)).toBe(true);
    }
  });

  it("places every anchor adjacent to the thing it serves", () => {
    const adjacency: Record<string, string> = {
      farmhouse: "farmhouse",
      coop: "coop",
      barn: "barn",
      well: "well",
      stand: "stand",
    };
    for (const [name, point] of Object.entries(ANCHORS)) {
      const neighbours = [
        tileAt(point.x + 1, point.y),
        tileAt(point.x - 1, point.y),
        tileAt(point.x, point.y + 1),
        tileAt(point.x, point.y - 1),
      ];
      expect(
        neighbours.some((t) => t?.building === adjacency[name]),
        `anchor ${name} should touch ${adjacency[name]}`,
      ).toBe(true);
    }
  });
});
