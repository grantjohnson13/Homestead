/**
 * Emits a standalone, openable copy of the farm view for eyeballing the art.
 *
 * The state it renders is not hand-written: it comes from actually playing the
 * simulation for a while, so the fixture shows a farm that could really exist —
 * crops at different stages, animals with real moods, customers mid-wait.
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
  createFarm,
  nextId,
  validateBatch,
  type FarmState,
  type TaskInput,
} from "../src/sim/index.ts";
import { snapshot } from "../src/tools/snapshot.ts";
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

function main(): void {
  const farm = stagedFarm();
  const state = snapshot(farm);
  const html = buildFarmViewHtml();

  const injection = `
<script>
  // Standalone preview: there is no MCP host here, so feed the renderer directly.
  (function () {
    var STATE = ${JSON.stringify(state).replace(/</g, "\\u003c")};
    function paint() {
      if (window.__homesteadRender) {
        window.__homesteadRender(STATE);
      } else {
        setTimeout(paint, 30);
      }
    }
    paint();
  })();
</script>
</body>`;

  const fixture = html.replace("</body>", injection);

  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "farm-view-fixture.html");
  writeFileSync(outFile, fixture, "utf8");

  process.stdout.write(
    `build-fixture: wrote ${outFile}\n` +
      `  clock ${state.clock}m, ${state.gold}g, rep ${state.reputation}, ` +
      `${state.customers.length} customer(s), ${state.animals.length} animal(s)\n`,
  );
}

main();
