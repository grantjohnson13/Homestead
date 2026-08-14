/**
 * The farm map: a fixed 16x12 grid, hand-authored as ASCII art so it stays easy
 * to edit. Change the picture, change the farm.
 *
 * Legend:
 *   f  fence      (blocked)
 *   .  grass      (walkable)
 *   #  path       (walkable)
 *   P  plot       (walkable — Wren stands on the soil to work it)
 *   H  farmhouse  (blocked)
 *   C  coop       (blocked)
 *   B  barn       (blocked, doubles as storage)
 *   S  farm stand (blocked — customers queue on the south side)
 *   W  well       (blocked)
 *
 * Plots are numbered left-to-right, top-to-bottom as plot_1 .. plot_12.
 */

export const MAP_WIDTH = 16;
export const MAP_HEIGHT = 12;

export const MAP_ART: readonly string[] = [
  "ffffffffffffffff",
  "fHH..........CCf",
  "fHH..........CCf",
  "f...#######....f",
  "f...#PPPP.#....f",
  "f...#PPPP.#.BB.f",
  "f...#PPPP.#.BB.f",
  "f...#######....f",
  "f..............f",
  "fW.....SS......f",
  "f..............f",
  "ffffffffffffffff",
];

export const TILE_TYPES = [
  "grass",
  "path",
  "plot",
  "water",
  "building",
  "stand",
  "fence",
] as const;
export type TileType = (typeof TILE_TYPES)[number];

/** Which building a `building` tile belongs to, for tooltips and art. */
export type BuildingId = "farmhouse" | "coop" | "barn" | "well" | "stand";

const CHAR_TO_TILE: Record<string, { type: TileType; building?: BuildingId }> = {
  f: { type: "fence" },
  ".": { type: "grass" },
  "#": { type: "path" },
  P: { type: "plot" },
  H: { type: "building", building: "farmhouse" },
  C: { type: "building", building: "coop" },
  B: { type: "building", building: "barn" },
  S: { type: "stand", building: "stand" },
  W: { type: "water", building: "well" },
};

export interface Tile {
  x: number;
  y: number;
  type: TileType;
  building?: BuildingId;
  walkable: boolean;
  /** Present on `plot` tiles: "plot_1" .. "plot_12". */
  plotId?: string;
}

const WALKABLE: ReadonlySet<TileType> = new Set<TileType>(["grass", "path", "plot"]);

function buildTiles(): Tile[] {
  const tiles: Tile[] = [];
  let plotN = 0;
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row = MAP_ART[y];
    if (row === undefined || row.length !== MAP_WIDTH) {
      throw new Error(`MAP_ART row ${y} must be exactly ${MAP_WIDTH} chars`);
    }
    for (let x = 0; x < MAP_WIDTH; x++) {
      const ch = row[x] as string;
      const def = CHAR_TO_TILE[ch];
      if (!def) throw new Error(`Unknown map char "${ch}" at ${x},${y}`);
      const tile: Tile = {
        x,
        y,
        type: def.type,
        walkable: WALKABLE.has(def.type),
      };
      if (def.building) tile.building = def.building;
      if (def.type === "plot") {
        plotN += 1;
        tile.plotId = `plot_${plotN}`;
      }
      tiles.push(tile);
    }
  }
  return tiles;
}

export const TILES: readonly Tile[] = buildTiles();

export function tileAt(x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return undefined;
  return TILES[y * MAP_WIDTH + x];
}

export function isWalkable(x: number, y: number): boolean {
  return tileAt(x, y)?.walkable ?? false;
}

export interface Point {
  x: number;
  y: number;
}

/** The 12 plot tiles, in plot_1..plot_12 order. */
export const PLOT_TILES: readonly Tile[] = TILES.filter((t) => t.type === "plot");

export const PLOT_IDS: readonly string[] = PLOT_TILES.map((t) => t.plotId as string);

/**
 * Where Wren stands to interact with each building, and where customers queue.
 * These are walkable tiles adjacent to the (blocked) structure.
 */
export const ANCHORS = {
  farmhouse: { x: 2, y: 3 },
  coop: { x: 13, y: 3 },
  barn: { x: 12, y: 7 },
  well: { x: 2, y: 9 },
  stand: { x: 7, y: 8 },
} as const satisfies Record<BuildingId, Point>;

/** Customers stand south of the stand, so they face Wren across the counter. */
export const CUSTOMER_SPOTS: readonly Point[] = [
  { x: 6, y: 10 },
  { x: 7, y: 10 },
  { x: 8, y: 10 },
  { x: 9, y: 10 },
  { x: 5, y: 10 },
];

/** Wren's home tile — where she idles and recovers stamina. */
export const WREN_HOME: Point = ANCHORS.farmhouse;

export function plotTile(plotId: string): Tile | undefined {
  return PLOT_TILES.find((t) => t.plotId === plotId);
}

/** Sanity: every anchor must actually be walkable, or Wren can never arrive. */
for (const [name, point] of Object.entries(ANCHORS)) {
  if (!isWalkable(point.x, point.y)) {
    throw new Error(`Anchor "${name}" at ${point.x},${point.y} is not walkable`);
  }
}
