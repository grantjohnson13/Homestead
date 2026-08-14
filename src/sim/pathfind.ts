/**
 * Grid pathfinding. The map is 16x12 with no weights, so a breadth-first search
 * is both optimal and instant — A* would be ceremony without benefit.
 */

import { MAP_HEIGHT, MAP_WIDTH, isWalkable, type Point } from "../data/map.ts";

const DIRECTIONS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function index(x: number, y: number): number {
  return y * MAP_WIDTH + x;
}

/**
 * Shortest walkable path from `from` to `to`, excluding the starting tile and
 * including the destination. Returns null if the destination is unreachable.
 * An already-arrived request returns an empty path.
 */
export function findPath(from: Point, to: Point): Point[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (!isWalkable(to.x, to.y)) return null;
  if (!isWalkable(from.x, from.y)) return null;

  const cameFrom = new Int32Array(MAP_WIDTH * MAP_HEIGHT).fill(-1);
  const start = index(from.x, from.y);
  const goal = index(to.x, to.y);
  cameFrom[start] = start;

  const queue: number[] = [start];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++] as number;
    if (current === goal) return reconstruct(cameFrom, start, goal);

    const cx = current % MAP_WIDTH;
    const cy = (current - cx) / MAP_WIDTH;
    for (const [dx, dy] of DIRECTIONS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
      if (!isWalkable(nx, ny)) continue;
      const next = index(nx, ny);
      if (cameFrom[next] !== -1) continue;
      cameFrom[next] = current;
      queue.push(next);
    }
  }

  return null;
}

function reconstruct(cameFrom: Int32Array, start: number, goal: number): Point[] {
  const path: Point[] = [];
  let cursor = goal;
  while (cursor !== start) {
    const x = cursor % MAP_WIDTH;
    path.push({ x, y: (cursor - x) / MAP_WIDTH });
    cursor = cameFrom[cursor] as number;
  }
  path.reverse();
  return path;
}

/** Manhattan distance — used for cheap "is she close?" checks, never for routing. */
export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Which way a mover faces when stepping from `a` to `b`. */
export function facingFor(a: Point, b: Point): "up" | "down" | "left" | "right" | null {
  if (b.x > a.x) return "right";
  if (b.x < a.x) return "left";
  if (b.y > a.y) return "down";
  if (b.y < a.y) return "up";
  return null;
}
