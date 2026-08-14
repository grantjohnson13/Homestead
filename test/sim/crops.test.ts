import { describe, expect, it } from "vitest";
import { CROPS, moistureSegment } from "../../src/data/crops.ts";
import {
  advance,
  harvestPlot,
  isHarvestable,
  plotProgressFraction,
  plotStage,
  waterPlot,
  type Plot,
} from "../../src/sim/index.ts";
import { eventText, makeFarm, plant, plotOf } from "./helpers.ts";

describe("crop growth", () => {
  it("does not grow at all without water", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "radish");
    advance(farm, 50);
    expect(plotOf(farm, "plot_1").progress).toBe(0);
    expect(isHarvestable(plotOf(farm, "plot_1"))).toBe(false);
  });

  it("grows exactly one minute per watered minute", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "radish");
    waterPlot(plotOf(farm, "plot_1"));
    advance(farm, 5);
    expect(plotOf(farm, "plot_1").progress).toBe(5);
  });

  it("becomes harvestable after its full grow time, given enough water", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "radish");
    waterPlot(plotOf(farm, "plot_1")); // radish needs exactly 1 watering
    advance(farm, CROPS.radish.growMinutes);
    expect(isHarvestable(plotOf(farm, "plot_1"))).toBe(true);
  });

  it("stalls when moisture runs out and resumes when watered again", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "lettuce"); // 35 min over 2 waterings => 17.5 per watering
    const plot = plotOf(farm, "plot_1");
    waterPlot(plot);

    advance(farm, 30);
    const stalled = plot.progress;
    expect(stalled).toBeLessThan(CROPS.lettuce.growMinutes);
    expect(plot.moisture).toBe(0);

    advance(farm, 10);
    expect(plot.progress).toBe(stalled); // still stalled

    waterPlot(plot);
    advance(farm, 30);
    expect(plot.progress).toBe(CROPS.lettuce.growMinutes);
    expect(isHarvestable(plot)).toBe(true);
  });

  it("never kills an unwatered crop", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "pumpkin");
    advance(farm, 500);
    expect(plotOf(farm, "plot_1").crop).toBe("pumpkin");
  });

  it("caps moisture at one watering's worth so you cannot front-load water", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "tomato");
    const plot = plotOf(farm, "plot_1");
    const segment = moistureSegment(CROPS.tomato);

    expect(waterPlot(plot)).toBe(true);
    expect(plot.moisture).toBe(segment);
    // Watering again while saturated does nothing.
    expect(waterPlot(plot)).toBe(false);
    expect(plot.moisture).toBe(segment);
  });

  it("requires exactly waterNeeds waterings to finish on schedule", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "tomato"); // 60 min over 3 waterings
    const plot = plotOf(farm, "plot_1");

    let waterings = 0;
    for (let i = 0; i < CROPS.tomato.growMinutes + 10; i++) {
      if (plot.moisture <= 0 && !isHarvestable(plot)) {
        waterPlot(plot);
        waterings += 1;
      }
      advance(farm, 1);
    }
    expect(isHarvestable(plot)).toBe(true);
    expect(waterings).toBe(CROPS.tomato.waterNeeds);
  });

  it("reports the four growth stages in order", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "corn");
    const plot = plotOf(farm, "plot_1");
    const seen: (string | null)[] = [];

    for (let i = 0; i < CROPS.corn.growMinutes; i++) {
      if (plot.moisture <= 0) waterPlot(plot);
      advance(farm, 1);
      const stage = plotStage(plot);
      if (seen[seen.length - 1] !== stage) seen.push(stage);
    }

    expect(seen).toEqual(["seed", "sprout", "growing", "mature"]);
  });

  it("reports progress as a 0..1 fraction", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "radish");
    const plot = plotOf(farm, "plot_1");
    expect(plotProgressFraction(plot)).toBe(0);
    waterPlot(plot);
    advance(farm, 10);
    expect(plotProgressFraction(plot)).toBeCloseTo(0.5, 5);
  });

  it("announces when a crop becomes ready, exactly once", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "radish");
    waterPlot(plotOf(farm, "plot_1"));
    advance(farm, 40);
    const readyEvents = farm.events.filter((e) => e.text.includes("ready to harvest"));
    expect(readyEvents).toHaveLength(1);
  });

  it("warns when a plot dries out", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "corn");
    waterPlot(plotOf(farm, "plot_1"));
    advance(farm, 40);
    expect(eventText(farm)).toContain("dried out");
  });
});

describe("multi-harvest crops", () => {
  it("regrows a tomato after the first harvest instead of clearing the plot", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "tomato", CROPS.tomato.growMinutes);
    const plot = plotOf(farm, "plot_1");
    expect(isHarvestable(plot)).toBe(true);

    const result = harvest(plot);
    expect(result?.spent).toBe(false);
    expect(plot.crop).toBe("tomato");
    expect(plot.harvestsDone).toBe(1);
    expect(isHarvestable(plot)).toBe(false);
    // Needs regrowFraction of its grow time again.
    expect(plot.progress).toBeCloseTo(
      CROPS.tomato.growMinutes * (1 - CROPS.tomato.regrowFraction),
      5,
    );
  });

  it("clears the plot back to tilled on the final harvest", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "tomato", CROPS.tomato.growMinutes);
    const plot = plotOf(farm, "plot_1");

    harvest(plot);
    plot.progress = CROPS.tomato.growMinutes;
    const second = harvest(plot);

    expect(second?.spent).toBe(true);
    expect(plot.crop).toBeNull();
    expect(plot.tilled).toBe(true);
    expect(plot.harvestsDone).toBe(0);
  });

  it("gives strawberries three harvests", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "strawberry", CROPS.strawberry.growMinutes);
    const plot = plotOf(farm, "plot_1");

    let spentAfter = 0;
    for (let i = 1; i <= CROPS.strawberry.harvests; i++) {
      plot.progress = CROPS.strawberry.growMinutes;
      const result = harvest(plot);
      if (result?.spent) spentAfter = i;
    }
    expect(spentAfter).toBe(CROPS.strawberry.harvests);
  });

  it("leaves a single-harvest crop's plot tilled and ready to replant", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "radish", CROPS.radish.growMinutes);
    const plot = plotOf(farm, "plot_1");
    const result = harvest(plot);
    expect(result?.spent).toBe(true);
    expect(plot.tilled).toBe(true);
  });

  it("refuses to harvest a crop that is not ready", () => {
    const farm = makeFarm();
    plant(farm, "plot_1", "radish", 5);
    expect(harvest(plotOf(farm, "plot_1"))).toBeNull();
  });
});

/** Local shim so the tests read cleanly; yield amount is irrelevant here. */
function harvest(plot: Plot) {
  return harvestPlot(plot, 1);
}
