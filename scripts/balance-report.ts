/**
 * Prints how each scripted player fares over several horizons.
 *
 * This is the tuning instrument: run it, look at the spread, adjust
 * `src/sim/constants.ts` or `src/data/crops.ts`, run it again. The assertions in
 * `test/sim/balance.test.ts` then lock in whatever band we settled on.
 */

import { PLAYERS, play } from "../test/sim/players.ts";

const HORIZONS = [30, 120, 300, 600];
const SEEDS = [1, 7, 42, 1234, 99999];

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

for (const ticks of HORIZONS) {
  process.stdout.write(`\n=== ${ticks} game-minutes ===\n`);
  process.stdout.write(
    `${"player".padEnd(16)}${pad("gold", 7)}${pad("Δgold", 8)}${pad("low", 6)}${pad("rep", 5)}${pad("sales", 7)}${pad("harv", 6)}${pad("walk", 6)}${pad("miss", 6)}\n`,
  );

  for (const player of PLAYERS) {
    const runs = SEEDS.map((seed) =>
      play(player.name, seed, ticks, player.policy, player.options ?? {}),
    );
    const avg = (pick: (r: (typeof runs)[number]) => number) =>
      Math.round(runs.reduce((sum, r) => sum + pick(r), 0) / runs.length);

    process.stdout.write(
      player.name.padEnd(16) +
        pad(
          avg((r) => r.gold),
          7,
        ) +
        pad(
          avg((r) => r.goldDelta),
          8,
        ) +
        pad(
          avg((r) => r.goldLow),
          6,
        ) +
        pad(
          avg((r) => r.reputation),
          5,
        ) +
        pad(
          avg((r) => r.sales),
          7,
        ) +
        pad(
          avg((r) => r.harvests),
          6,
        ) +
        pad(
          avg((r) => r.walkouts),
          6,
        ) +
        pad(
          avg((r) => r.timeouts),
          6,
        ) +
        "\n",
    );
  }
}

process.stdout.write("\n");
