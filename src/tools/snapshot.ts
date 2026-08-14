/**
 * Turning a FarmState into the payload tools return and the farm view renders.
 *
 * Two audiences, one object: Claude needs enough to narrate without a second
 * call, and the iframe needs enough to draw the whole farm. Anything static
 * (the map, crop tables) is baked into the UI instead of shipped every poll.
 */

import { ANIMALS } from "../data/animals.ts";
import { CROPS } from "../data/crops.ts";
import { GOODS, GOOD_IDS, describeGood, type GoodId } from "../data/items.ts";
import { MAP_ART, MAP_HEIGHT, MAP_WIDTH } from "../data/map.ts";
import {
  affordable,
  basketPrice,
  farmTime,
  fulfillment,
  isHarvestable,
  priceOf,
  minutesToProduce,
  isFed,
  moodLabel,
  patienceRemaining,
  plotProgressFraction,
  plotStage,
  sellableGoods,
  speedOf,
  upgradeCatalogue,
  type FarmState,
  type FarmTime,
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
  /** What their basket costs at your current prices. */
  yourPrice: number;
  patienceLeft: number;
  patienceTotal: number;
  x: number;
  y: number;
  canFulfill: boolean;
  missing: string[];
  /**
   * Whether your price is within what they will pay. Their actual ceiling stays
   * hidden until they walk — finding it is the game.
   */
  affordable: boolean;
}

export interface LostSaleSnapshot {
  at: number;
  customer: string;
  reason: "price" | "stock";
  wanted: string;
  yourPrice: number;
  /** Only meaningful for a price walkout. */
  theirMax: number;
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
  /** Raw game-minutes since the farm was created. */
  clock: number;
  /** The same instant as a farm day-clock, for anything player-facing. */
  time: FarmTime;
  /** Game-minutes per real second. 1 is normal. */
  speed: number;
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
  /** Your asking price per unit, and the market reference for comparison. */
  prices: { good: string; yourPrice: number; referencePrice: number }[];
  /**
   * Why the road is quiet, when it is. Nobody walks out to a farm with nothing
   * to sell, and without saying so the farm just goes silent for no visible
   * reason — which is exactly how it feels like a bug rather than a rule.
   */
  standStatus: {
    open: boolean;
    reason: string;
  };
  /** Recent customers who left without buying, and why. */
  lostSales: LostSaleSnapshot[];
  /** Everything investable, with current level and the next price. */
  upgrades: ReturnType<typeof upgradeCatalogue>;
  /** What Wren does on her own when nothing is queued. */
  standingOrders: FarmState["standingOrders"];
  recentEvents: { at: number; kind: string; text: string }[];
}

export function snapshot(state: FarmState): FarmSnapshot {
  return {
    clock: Math.floor(state.clock),
    time: farmTime(state.clock),
    speed: speedOf(state),
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
        yourPrice: basketPrice(state, customer.wants),
        patienceLeft: patienceRemaining(state, customer),
        patienceTotal: customer.patience,
        x: customer.spot.x,
        y: customer.spot.y,
        canFulfill,
        missing: missing.map((m) => describeGood(m.good, m.qty)),
        affordable: affordable(state, customer),
      };
    }),
    inventory: { ...state.inventory },
    stand: { ...state.stand },
    prices: GOOD_IDS.map((good) => ({
      good,
      yourPrice: priceOf(state, good),
      referencePrice: GOODS[good].basePrice,
    })),
    standStatus: standStatus(state),
    upgrades: upgradeCatalogue(state),
    standingOrders: { ...state.standingOrders },
    lostSales: state.lostSales.map((lost) => ({
      at: lost.at,
      customer: lost.customer,
      reason: lost.reason,
      wanted: lost.wants.map((w) => describeGood(w.good, w.qty)).join(" and "),
      yourPrice: lost.yourPrice,
      theirMax: lost.theirMax,
      missing: [...lost.missing],
    })),
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

/**
 * Whether anyone is likely to turn up, and if not, why not.
 *
 * The commonest way for a farm to stall is silently: nothing harvested, nothing
 * in the barn, so nobody comes, so no income, so nothing gets planted. Naming
 * the cause turns a mysterious quiet road into an obvious next move.
 */
function standStatus(state: FarmState): { open: boolean; reason: string } {
  const sellable = sellableGoods(state);
  if (sellable.length === 0) {
    return {
      open: false,
      reason:
        "Nobody is coming — the farm has nothing to sell. Grow or collect something, and " +
        "customers will start turning up again.",
    };
  }

  const onStand = Object.values(state.stand).reduce((sum, n) => sum + n, 0);
  if (onStand === 0) {
    return {
      open: false,
      reason:
        "The stand is bare, though the barn is not. Queue a restock task so there is something " +
        "out front to buy.",
    };
  }

  return { open: true, reason: "The stand is open for business." };
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
    `${snap.time.label} (${snap.time.partOfDay}) | ${snap.gold}g | reputation ${snap.reputation}/100` +
      (snap.speed === 1 ? "" : ` | running at ${snap.speed}x`) +
      (snap.paused ? " | (world was paused)" : ""),
  );

  const wren = snap.wren;
  const doing = wren.currentTask
    ? `${wren.currentTask.action} ${wren.currentTask.target ?? ""}`.trim()
    : "idle";
  const orders = snap.standingOrders;
  lines.push(
    `${wren.name}: ${doing}, stamina ${wren.stamina}/100${wren.exhausted ? " (worn out)" : ""}, ` +
      `${wren.queue.length} task(s) queued` +
      (orders?.enabled
        ? ` — running the farm herself (planting ${orders.plant}, reserve ${orders.reserve}g)`
        : " — waiting to be told what to do"),
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

  const marked = snap.prices.filter((p) => p.yourPrice !== p.referencePrice);
  lines.push(
    `Your prices: ${snap.prices.map((p) => `${p.good} ${p.yourPrice}g`).join(", ")}` +
      (marked.length > 0
        ? ` (${marked.length} set away from the market reference)`
        : " (all at the market reference)"),
  );

  if (snap.customers.length > 0) {
    lines.push("Browsing the stand:");
    for (const c of snap.customers) {
      const blockers: string[] = [];
      if (!c.canFulfill) blockers.push(`stand is short ${c.missing.join(", ")}`);
      if (!c.affordable) blockers.push("your price is above what they'll pay");
      lines.push(
        `  ${c.name} (${c.id}) wants ${c.wants.map((w) => w.label).join(" and ")} — ` +
          `your price ${c.yourPrice}g — ${c.patienceLeft}m left — ` +
          (blockers.length === 0 ? "buying now" : blockers.join("; ")),
      );
    }
  } else {
    lines.push(`Nobody at the stand right now. ${snap.standStatus.reason}`);
  }

  if (snap.lostSales.length > 0) {
    const recent = snap.lostSales.slice(-4);
    lines.push("Recently lost sales:");
    for (const lost of recent) {
      lines.push(
        lost.reason === "price"
          ? `  ${lost.customer} wanted ${lost.wanted}: you asked ${lost.yourPrice}g, they'd have paid ${lost.theirMax}g`
          : `  ${lost.customer} wanted ${lost.wanted}: stand was short ${lost.missing.join(", ")}`,
      );
    }
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
