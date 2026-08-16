/**
 * Emits a standalone, openable copy of the farm view for eyeballing the art.
 *
 * The state it renders is not hand-written: it comes from actually playing the
 * simulation for a while, so the fixture shows a farm that could really exist —
 * crops at different stages, animals with real moods, customers mid-wait.
 *
 * It ships a *run* rather than a single frame, because half of what the view
 * does only exists between two states: Wren walking, coins off a sale, a crop
 * popping as it is picked. A still image cannot show any of it.
 *
 * Output: dist/farm-view-fixture.html  (open it in any browser)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addAnimal,
  addItem,
  advance,
  buySupplies,
  buyUpgrade,
  createFarm,
  nextId,
  validateBatch,
  type FarmState,
  type TaskInput,
} from "../src/sim/index.ts";
import { snapshot, type FarmSnapshot } from "../src/tools/snapshot.ts";
import { buildFarmViewHtml } from "./build-ui.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "dist");

function assign(state: FarmState, tasks: TaskInput[]): void {
  const verdicts = validateBatch(state, tasks, () => nextId(state, "task"));
  for (const verdict of verdicts) {
    if (verdict.accepted && verdict.task) state.wren.queue.push(verdict.task);
  }
}

/** Plays a farm into an interesting-looking mid-game state. */
function stagedFarm(): FarmState {
  const farm = createFarm(20260814, 0);

  farm.gold = 1240;
  farm.reputation = 78;
  addItem(farm.inventory, "corn_seed", 4);
  addItem(farm.inventory, "pumpkin_seed", 3);
  addItem(farm.inventory, "strawberry_seed", 3);
  addItem(farm.inventory, "lettuce_seed", 3);
  addAnimal(farm, "chicken");
  addAnimal(farm, "chicken");
  addAnimal(farm, "cow");

  // A field at mixed stages reads far better than a uniform one.
  const plan: [string, string][] = [
    ["plot_1", "radish"],
    ["plot_2", "lettuce"],
    ["plot_3", "tomato"],
    ["plot_4", "corn"],
    ["plot_5", "strawberry"],
    ["plot_6", "pumpkin"],
    ["plot_7", "tomato"],
    ["plot_8", "corn"],
  ];

  for (const [plotId, crop] of plan) {
    const plot = farm.plots.find((p) => p.id === plotId);
    if (!plot) continue;
    plot.tilled = false;
    plot.crop = crop as never;
    plot.harvestsDone = 0;
  }
  // plot_9 tilled and waiting, the rest untouched.
  const spare = farm.plots.find((p) => p.id === "plot_9");
  if (spare) spare.tilled = true;

  // Water everything, then let time do the rest so stages spread out naturally.
  for (const animal of farm.animals) animal.fedUntil = 400;
  for (const plot of farm.plots) {
    if (plot.crop) plot.moisture = 40;
  }
  advance(farm, 46);

  // Stock the barn and the stand so customers have something to want.
  addItem(farm.inventory, "egg", 6);
  addItem(farm.inventory, "milk", 2);
  addItem(farm.stand, "radish", 4);
  addItem(farm.stand, "tomato", 5);
  addItem(farm.stand, "egg", 3);

  advance(farm, 30);

  // Give Wren something visible to be doing, and a queue worth showing.
  assign(farm, [
    { type: "water", target: "plot_6" },
    { type: "harvest", target: "plot_1" },
    { type: "collect", target: "all_chickens" },
    { type: "restock", target: "all" },
    { type: "feed", target: "all_animals" },
    { type: "pet", target: "all_cows" },
  ]);
  advance(farm, 6);

  return farm;
}

/** Game-minutes between captured frames, matching the view's normal 2s poll. */
const FRAME_MINUTES = 2;
const FRAME_COUNT = 150;

/**
 * Plays the staged farm forward, capturing what the view would have polled.
 *
 * Two purchases are staged partway in — supplies and an upgrade — because
 * spending is otherwise the one economic move the simulation never makes on its
 * own, and it has its own animation to check.
 */
function timeline(): FarmSnapshot[] {
  const farm = stagedFarm();
  const frames: FarmSnapshot[] = [snapshot(farm)];

  for (let i = 0; i < FRAME_COUNT; i++) {
    if (i === 20) buySupplies(farm, "tomato_seed", 5);
    if (i === 45) buyUpgrade(farm, "watering_can");
    advance(farm, FRAME_MINUTES);
    frames.push(snapshot(farm));
  }

  return frames;
}

/** How many of the frames show money changing hands, for the build log. */
function countSales(frames: FarmSnapshot[]): number {
  let sales = 0;
  for (let i = 1; i < frames.length; i++) {
    const before = new Set(frames[i - 1]!.customers.map((c) => c.id));
    for (const id of frames[i]!.customers.map((c) => c.id)) before.delete(id);
    sales += before.size;
  }
  return sales;
}

function main(): void {
  const frames = timeline();
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  const html = buildFarmViewHtml();

  const injection = `
<script>
  // Standalone preview: there is no MCP host here, so feed the renderer the
  // recorded run directly, one frame per poll, looping forever.
  (function () {
    var FRAMES = ${JSON.stringify(frames).replace(/</g, "\\u003c")};
    var FRAME_MS = 1400;
    var at = 0;

    function paint() {
      if (!window.__homesteadRender) {
        setTimeout(paint, 30);
        return;
      }
      window.__homesteadRender(FRAMES[at]);
      at++;
      if (at >= FRAMES.length) {
        // Restart from a clean slate, so the loop point is not read as one
        // enormous change to every number at once.
        at = 0;
        setTimeout(function () {
          location.reload();
        }, 2500);
        return;
      }
      setTimeout(paint, FRAME_MS);
    }

    paint();
  })();
</script>
</body>`;

  const fixture = html.replace("</body>", injection);

  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "farm-view-fixture.html");
  writeFileSync(outFile, fixture, "utf8");

  const kb = (Buffer.byteLength(fixture, "utf8") / 1024).toFixed(0);
  process.stdout.write(
    `build-fixture: wrote ${outFile} (${kb} kB)\n` +
      `  ${frames.length} frames over ${FRAME_COUNT * FRAME_MINUTES} game-minutes, ` +
      `${countSales(frames)} customer departure(s)\n` +
      `  ${first.gold}g → ${last.gold}g, rep ${first.reputation} → ${last.reputation}, ` +
      `${last.animals.length} animal(s)\n`,
  );
}

main();
