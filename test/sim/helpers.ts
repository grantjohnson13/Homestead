import { createFarm, validateBatch, type FarmState, type TaskInput } from "../../src/sim/index.ts";

let idCounter = 0;

/** A fresh farm with a fixed seed, so every test is reproducible. */
export function makeFarm(seed = 1234): FarmState {
  idCounter = 0;
  return createFarm(seed, 0);
}

/** Validates and enqueues tasks the way assign_tasks does. Returns the verdicts. */
export function assign(state: FarmState, tasks: TaskInput[]) {
  const verdicts = validateBatch(state, tasks, () => `t${++idCounter}`);
  for (const verdict of verdicts) {
    if (verdict.accepted && verdict.task) state.wren.queue.push(verdict.task);
  }
  return verdicts;
}

/** Enqueues tasks and asserts they were all accepted. */
export function assignOrThrow(state: FarmState, tasks: TaskInput[]) {
  const verdicts = assign(state, tasks);
  const rejected = verdicts.filter((v) => !v.accepted);
  if (rejected.length > 0) {
    throw new Error(
      `Unexpected rejections: ${rejected.map((r) => `[${r.index}] ${r.reason}`).join("; ")}`,
    );
  }
  return verdicts;
}

/** True once Wren has emptied her queue and finished what she was doing. */
export function isIdle(state: FarmState): boolean {
  return state.wren.queue.length === 0 && state.wren.current === null;
}

/** Gives a plot a crop directly, skipping the till/plant journey. */
export function plant(state: FarmState, plotId: string, crop: string, progress = 0): void {
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) throw new Error(`no plot ${plotId}`);
  plot.tilled = false;
  plot.crop = crop as never;
  plot.progress = progress;
  plot.moisture = 0;
  plot.harvestsDone = 0;
}

export function plotOf(state: FarmState, plotId: string) {
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) throw new Error(`no plot ${plotId}`);
  return plot;
}

/** Text of every event logged so far, for loose "did this happen?" assertions. */
export function eventText(state: FarmState): string {
  return state.events.map((e) => e.text).join("\n");
}
