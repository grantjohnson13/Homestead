/**
 * Crop growth.
 *
 * Growth accrues one game-minute at a time, but only while the plot still has
 * moisture. A dry plot simply stops — the crop waits, it never dies.
 */

import { CROPS, moistureSegment, stageForProgress, type GrowthStage } from "../data/crops.ts";
import { logEvent } from "./farm.ts";
import type { FarmState, Plot } from "./types.ts";

export function tickPlots(state: FarmState): void {
  for (const plot of state.plots) {
    if (!plot.crop) continue;
    const crop = CROPS[plot.crop];
    if (plot.progress >= crop.growMinutes) continue; // already harvestable
    if (plot.moisture <= 0) continue; // stalled, waiting for water

    const before = plot.progress;
    plot.progress = Math.min(crop.growMinutes, plot.progress + 1);
    plot.moisture = Math.max(0, plot.moisture - 1);

    if (before < crop.growMinutes && plot.progress >= crop.growMinutes) {
      logEvent(state, "crop", `${crop.name} in ${plot.id} is ready to harvest!`);
    } else if (plot.moisture === 0 && plot.progress < crop.growMinutes) {
      logEvent(
        state,
        "crop",
        `${plot.id} has dried out — the ${crop.name.toLowerCase()} has stopped growing.`,
      );
    }
  }
}

/** Tops a plot's moisture up to one watering's worth. */
export function waterPlot(plot: Plot): boolean {
  if (!plot.crop) return false;
  const crop = CROPS[plot.crop];
  const segment = moistureSegment(crop);
  if (plot.moisture >= segment) return false; // already saturated
  plot.moisture = segment;
  return true;
}

export function isHarvestable(plot: Plot): boolean {
  if (!plot.crop) return false;
  return plot.progress >= CROPS[plot.crop].growMinutes;
}

export function plotStage(plot: Plot): GrowthStage | null {
  if (!plot.crop) return null;
  return stageForProgress(plot.progress, CROPS[plot.crop].growMinutes);
}

/** 0..1 progress toward the current harvest, for the UI's growth bar. */
export function plotProgressFraction(plot: Plot): number {
  if (!plot.crop) return 0;
  return Math.min(1, plot.progress / CROPS[plot.crop].growMinutes);
}

/**
 * Applies a harvest: empties the plant if it is spent, or resets it to regrow.
 * Returns how much produce came off, or null if it was not harvestable.
 */
export function harvestPlot(plot: Plot, yieldAmount: number): { spent: boolean } | null {
  if (!isHarvestable(plot)) return null;
  const crop = CROPS[plot.crop as keyof typeof CROPS];
  plot.harvestsDone += 1;

  if (plot.harvestsDone >= crop.harvests) {
    plot.crop = null;
    plot.progress = 0;
    plot.moisture = 0;
    plot.harvestsDone = 0;
    plot.tilled = true;
    return { spent: true };
  }

  // Multi-harvest: the plant stays, but must regrow part of the way.
  plot.progress = crop.growMinutes * (1 - crop.regrowFraction);
  void yieldAmount;
  return { spent: false };
}
