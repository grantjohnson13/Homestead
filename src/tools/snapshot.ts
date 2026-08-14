/**
 * Turning a FarmState into the payload tools return and the farm view renders.
 *
 * Two audiences, one object: Claude needs enough to narrate without a second
 * call, and the iframe needs enough to draw the whole farm. Anything static
 * (the map, crop tables) is baked into the UI instead of shipped every poll.
 */

import { ANIMALS } from "../data/animals.ts";
import { CROPS } from "../data/crops.ts";
import { GOODS, describeGood, type GoodId } from "../data/items.ts";
import { MAP_ART, MAP_HEIGHT, MAP_WIDTH } from "../data/map.ts";
import {
  fulfillment,
  isHarvestable,
  minutesToProduce,
  isFed,
  moodLabel,
  patienceRemaining,
  plotProgressFraction,
  plotStage,
  type FarmState,
} from "../sim/index.ts";

export interface PlotSnapshot {
  id: string;
  x: number;
  y: number;
  /** "empty" | "tilled" | "growing" | "ready" */
  status: "empty" | "tilled" | "growing" | "ready";
  crop: string | null;
  stage: string | null;
  /** 0..1 toward the next harvest. */
  progress: number;
  /** Game-minutes of moisture left; 0 means growth has stalled. */
  moisture: number;
  watered: boolean;
  harvestsLeft: number;
  /** Estimated minutes to ripeness if kept watered, null when not growing. */
  minutesToReady: number | null;
}

export interface AnimalSnapshot {
  id: string;
  name: string;
  kind: string;
  mood: string;
  moodValue: number;
  fed: boolean;
  /** Uncollected produce sitting with the animal. */
  ready: number;
  produces: string;
  minutesToNext: number | null;
}

export interface CustomerSnapshot {
  id: string;
  name: string;
  portrait: number;
  wants: { good: string; qty: number; label: string }[];
  offer: number;
  patienceLeft: number;
  patienceTotal: number;
  x: number;
  y: number;
  canFulfill: boolean;
  missing: string[];
}

export interface WrenSnapshot {
  name: string;
  x: number;
  y: number;
  facing: string;
  stamina: number;
  exhausted: boolean;
  waterCharges: number;
  carrying: { good: string; qty: number }[];
  currentTask: { type: string; target?: string; crop?: string; action: string } | null;
  queue: { id: string; type: string; target?: string; crop?: string }[];
}

export interface FarmSnapshot {
  clock: number;
  gold: number;
  reputation: number;
  certificates: string[];
  paused: boolean;
  wren: WrenSnapshot;
  plots: PlotSnapshot[];
  animals: AnimalSnapshot[];
  customers: CustomerSnapshot[];
  inventory: Record<string, number>;
  stand: Record<string, number>;
  recentEvents: { at: number; kind: string; text: string }[];
}

export function snapshot(state: FarmState): FarmSnapshot {
  return {
    clock: Math.floor(state.clock),
    gold: state.gold,
    reputation: Math.round(state.reputation),
    certificates: [...state.certificates],
    paused: state.paused,
    wren: wrenSnapshot(state),
    plots: state.plots.map(plotSnapshot),
    animals: state.animals.map((animal) => ({
      id: animal.id,
      name: animal.name,
      kind: animal.kind,
      mood: moodLabel(animal),
      moodValue: Math.round(animal.mood),
      fed: isFed(animal, state.clock),
      ready: animal.pending,
      produces: ANIMALS[animal.kind].produces,
      minutesToNext: minutesToProduce(animal, state.clock),
    })),
    customers: state.customers.map((customer) => {
      const { canFulfill, missing } = fulfillment(state, customer);
      return {
        id: customer.id,
        name: customer.name,
        portrait: customer.portrait,
        wants: customer.wants.map((w) => ({
          good: w.good,
          qty: w.qty,
          label: describeGood(w.good, w.qty),
        })),
        offer: customer.offer,
        patienceLeft: patienceRemaining(state, customer),
        patienceTotal: customer.patience,
        x: customer.spot.x,
        y: customer.spot.y,
        canFulfill,
        missing: missing.map((m) => describeGood(m.good, m.qty)),
      };
    }),
    inventory: { ...state.inventory },
    stand: { ...state.stand },
    recentEvents: state.events.slice(-12).map((e) => ({ at: e.at, kind: e.kind, text: e.text })),
  };
}

function wrenSnapshot(state: FarmState): WrenSnapshot {
  const wren = state.wren;
  const active = wren.current;
  const leg = active?.legs[active.legIndex];
  return {
    name: wren.name,
    x: wren.x,
    y: wren.y,
    facing: wren.facing,
    stamina: Math.round(wren.stamina),
    exhausted: wren.exhausted,
    waterCharges: wren.waterCharges,
    carrying: wren.carrying.map((c) => ({ good: c.good, qty: c.qty })),
    currentTask: active
      ? {
          type: active.task.type,
          ...(active.task.target ? { target: active.task.target } : {}),
          ...(active.task.crop ? { crop: active.task.crop } : {}),
          // "walking" until she arrives, then the leg's own verb.
          action: active.path.length > 0 ? "walking" : (leg?.action ?? active.task.type),
        }
      : null,
    queue: wren.queue.map((t) => ({
      id: t.id,
      type: t.type,
      ...(t.target ? { target: t.target } : {}),
      ...(t.crop ? { crop: t.crop } : {}),
    })),
  };
}

function plotSnapshot(plot: FarmState["plots"][number]): PlotSnapshot {
  const ready = isHarvestable(plot);
  const crop = plot.crop ? CROPS[plot.crop] : null;

  let status: PlotSnapshot["status"] = "empty";
  if (plot.crop) status = ready ? "ready" : "growing";
  else if (plot.tilled) status = "tilled";

  return {
    id: plot.id,
    x: plot.x,
    y: plot.y,
    status,
    crop: plot.crop,
    stage: plotStage(plot),
    progress: Math.round(plotProgressFraction(plot) * 100) / 100,
    moisture: Math.round(plot.moisture),
    watered: plot.moisture > 0,
    harvestsLeft: crop ? crop.harvests - plot.harvestsDone : 0,
    minutesToReady:
      crop && !ready ? Math.max(0, Math.ceil(crop.growMinutes - plot.progress)) : null,
  };
}

/** Static map description — included only by get_farm_state, since it never changes. */
export function mapDescription() {
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    art: MAP_ART,
    legend: {
      f: "fence",
      ".": "grass",
      "#": "path",
      P: "plot",
      H: "farmhouse",
      C: "coop",
      B: "barn (also storage)",
      S: "farm stand",
      W: "well",
    },
  };
}

/* ---------------------------------------------------------------- prose --- */

/** A compact human-readable digest, so the tool is useful without the JSON. */
export function describeFarm(snap: FarmSnapshot): string {
  const lines: string[] = [];
  lines.push(
    `Day clock ${snap.clock}m | ${snap.gold}g | reputation ${snap.reputation}/100${snap.paused ? " | (world was paused)" : ""}`,
  );

  const wren = snap.wren;
  const doing = wren.currentTask
    ? `${wren.currentTask.action} ${wren.currentTask.target ?? ""}`.trim()
    : "idle";
  lines.push(
    `${wren.name}: ${doing}, stamina ${wren.stamina}/100${wren.exhausted ? " (worn out)" : ""}, ${wren.queue.length} task(s) queued`,
  );

  const growing = snap.plots.filter((p) => p.status === "growing");
  const ready = snap.plots.filter((p) => p.status === "ready");
  const tilled = snap.plots.filter((p) => p.status === "tilled");
  const empty = snap.plots.filter((p) => p.status === "empty");
  lines.push(
    `Field: ${ready.length} ready, ${growing.length} growing, ${tilled.length} tilled, ${empty.length} untilled`,
  );
  if (ready.length > 0) {
    lines.push(`  Ready now: ${ready.map((p) => `${p.id} (${p.crop})`).join(", ")}`);
  }
  const dry = growing.filter((p) => !p.watered);
  if (dry.length > 0) {
    lines.push(`  Stalled and thirsty: ${dry.map((p) => p.id).join(", ")}`);
  }

  if (snap.animals.length > 0) {
    lines.push(
      `Animals: ${snap.animals
        .map(
          (a) =>
            `${a.name} the ${a.kind} (${a.mood}${a.fed ? ", fed" : ", hungry"}${a.ready > 0 ? `, ${a.ready} to collect` : ""})`,
        )
        .join("; ")}`,
    );
  }

  lines.push(`Barn: ${describeBag(snap.inventory)}`);
  lines.push(`Stand: ${describeBag(snap.stand)}`);

  if (snap.customers.length > 0) {
    lines.push("Waiting customers:");
    for (const c of snap.customers) {
      lines.push(
        `  ${c.name} (${c.id}) wants ${c.wants.map((w) => w.label).join(" and ")} for ${c.offer}g` +
          ` — ${c.patienceLeft}m patience left — ${c.canFulfill ? "stand can fill this" : `stand is short ${c.missing.join(", ")}`}`,
      );
    }
  } else {
    lines.push("No customers at the stand right now.");
  }

  return lines.join("\n");
}

function describeBag(bag: Record<string, number>): string {
  const entries = Object.entries(bag).filter(([, qty]) => qty > 0);
  if (entries.length === 0) return "empty";
  return entries
    .map(([id, qty]) => (id in GOODS ? describeGood(id as GoodId, qty) : `${qty} x ${id}`))
    .join(", ");
}
