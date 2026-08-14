/**
 * The farm tool surface.
 *
 * These are written for an LLM: few tools, each powerful, each with a
 * description rich enough that Claude can pick the right one and fill it in
 * correctly on the first try. Results always carry a prose summary, the events
 * since the last call, and a state snapshot.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CROP_IDS } from "../data/crops.ts";
import { GOOD_IDS, describeGood } from "../data/items.ts";
import { PLOT_IDS } from "../data/map.ts";
import { SHOP_ITEMS } from "../data/shop.ts";
import {
  DEFAULT_WREN_NAME,
  buySupplies,
  createFarm,
  findAnimal,
  fulfillment,
  makeSeed,
  nextId,
  patienceRemaining,
  sellToCustomer,
  validateBatch,
  wrenLine,
  type FarmState,
  type QueuedTask,
  type TaskInput,
} from "../sim/index.ts";
import { registerFarmViewTool } from "./app-tool.ts";
import { buildResult, refusal, takeAwaySummary } from "./result.ts";
import { describeFarm, mapDescription, snapshot } from "./snapshot.ts";
import { withFarm, type FarmStore } from "./store.ts";

const TASK_TYPE_VALUES = [
  "till",
  "plant",
  "water",
  "harvest",
  "feed",
  "collect",
  "restock",
  "pet",
  "idle",
] as const;

export function registerFarmTools(server: McpServer, store: FarmStore): void {
  registerGetFarmState(server, store);
  registerAssignTasks(server, store);
  registerClearQueue(server, store);
  registerReorderQueue(server, store);
  registerBuySupplies(server, store);
  registerListCustomers(server, store);
  registerSellToCustomer(server, store);
  registerRename(server, store);
  registerNewFarm(server, store);
}

/* ------------------------------------------------------------------ state -- */

function registerGetFarmState(server: McpServer, store: FarmStore): void {
  registerFarmViewTool(
    server,
    "get_farm_state",
    {
      title: "Look at the farm",
      description:
        "The complete live picture of the farm: the map, all 12 plots with their crop, growth " +
        "stage, moisture and time-to-ripe, every animal with mood and uncollected produce, " +
        "Wren's position, current task, queue and stamina, barn and stand inventories, gold, " +
        "reputation, the game clock, and any customers waiting. Call this whenever the player " +
        "asks what's happening, when you need to check something before acting, or to see what " +
        "changed while you were talking — the world keeps ticking between messages.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { state, eventCursor } = await withFarm(store, () => undefined);
      return buildResult(state, {
        summary: "Here's how the farm looks right now.",
        eventCursor,
        extra: { map: mapDescription() },
        awaySummary: takeAwaySummary(state),
      });
    },
  );
}

/* ------------------------------------------------------------------ tasks -- */

function registerAssignTasks(server: McpServer, store: FarmStore): void {
  registerFarmViewTool(
    server,
    "assign_tasks",
    {
      title: "Give Wren a list of jobs",
      description:
        "Queue work for Wren, in order. This is the main way to play, and it is designed for " +
        "batches: send everything the player asked for in one call rather than one call per job.\n\n" +
        "Task types: till (prepare bare soil), plant (needs `crop` and a tilled plot), water, " +
        "harvest, feed, collect (fetch eggs/milk from the animals), pet, restock (carry goods " +
        "from the barn out to the farm stand, which is the ONLY place customers can buy from), " +
        "and idle.\n\n" +
        `Targets: plots are "plot_1".."plot_${PLOT_IDS.length}". Animal tasks take an animal id, ` +
        'an animal name, or a group: "all_chickens", "all_cows", "all_animals". restock takes a ' +
        'good ("tomato", "egg") or "all", with an optional `qty`.\n\n' +
        'Example: [{"type":"till","target":"plot_3"},{"type":"plant","target":"plot_3",' +
        '"crop":"tomato"},{"type":"water","target":"plot_3"},{"type":"feed","target":"all_chickens"}]\n\n' +
        "Ordering is respected, and the batch is validated as a sequence — so till-then-plant on " +
        "the same plot is accepted even though the plot is untilled right now. Every task comes " +
        "back with an individual accepted/rejected verdict and a plain reason, so relay any " +
        "rejection to the player rather than silently retrying.",
      inputSchema: {
        tasks: z
          .array(
            z.object({
              type: z.enum(TASK_TYPE_VALUES).describe("What kind of work this is."),
              target: z
                .string()
                .optional()
                .describe(
                  "Plot id, animal id/name, animal group, or good id — see the description.",
                ),
              crop: z
                .enum(CROP_IDS)
                .optional()
                .describe("Which crop to sow. Required for plant tasks."),
              qty: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("How many units to carry, for restock tasks."),
            }),
          )
          .min(1)
          .describe("The jobs to queue, in the order Wren should do them."),
        mode: z
          .enum(["append", "replace"])
          .optional()
          .describe(
            'Default "append" adds to the end of the queue. "replace" clears the pending queue ' +
              "first (the job she is already doing is allowed to finish).",
          ),
      },
    },
    async ({ tasks, mode }) => {
      const { state, result, eventCursor } = await withFarm(store, (farm) => {
        if (mode === "replace") farm.wren.queue = [];
        const verdicts = validateBatch(farm, tasks as TaskInput[], () => nextId(farm, "task"));
        for (const verdict of verdicts) {
          if (verdict.accepted && verdict.task) farm.wren.queue.push(verdict.task);
        }
        return verdicts;
      });

      const accepted = result.filter((v) => v.accepted);
      const rejected = result.filter((v) => !v.accepted);

      const summary =
        rejected.length === 0
          ? `Queued ${accepted.length} task(s) for ${state.wren.name}.`
          : `Queued ${accepted.length} task(s); ${rejected.length} could not be queued.`;

      return buildResult(state, {
        summary,
        eventCursor,
        wrenLine: accepted.length > 0 ? wrenLine(state, "assigned") : undefined,
        awaySummary: takeAwaySummary(state),
        extra: {
          assigned: result.map((v) => ({
            index: v.index,
            accepted: v.accepted,
            ...(v.reason ? { reason: v.reason } : {}),
            ...(v.task ? { taskId: v.task.id, type: v.task.type, target: v.task.target } : {}),
          })),
          rejectedCount: rejected.length,
        },
      });
    },
  );
}

function registerClearQueue(server: McpServer, store: FarmStore): void {
  registerFarmViewTool(
    server,
    "clear_task_queue",
    {
      title: "Clear Wren's queue",
      description:
        "Drops every pending task. The job Wren is in the middle of is allowed to finish, since " +
        "abandoning a half-dug bed helps nobody. Use this when the player changes their mind " +
        'about a plan ("actually, forget all that").',
      inputSchema: {},
    },
    async () => {
      const { state, result, eventCursor } = await withFarm(store, (farm) => {
        const dropped = farm.wren.queue.length;
        farm.wren.queue = [];
        return dropped;
      });

      return buildResult(state, {
        summary:
          result === 0
            ? `${state.wren.name}'s queue was already empty.`
            : `Cleared ${result} pending task(s) from ${state.wren.name}'s queue.`,
        eventCursor,
        wrenLine: result > 0 ? wrenLine(state, "queueCleared") : undefined,
        awaySummary: takeAwaySummary(state),
        extra: { dropped: result },
      });
    },
  );
}

function registerReorderQueue(server: McpServer, store: FarmStore): void {
  registerFarmViewTool(
    server,
    "reorder_task_queue",
    {
      title: "Reorder Wren's queue",
      description:
        "Rearranges the pending queue. Pass task ids (from assign_tasks or get_farm_state) in " +
        "the order you want them done. Any queued task you leave out keeps its relative order " +
        "at the back, so you can promote one urgent job without respecifying the whole list.",
      inputSchema: {
        order: z
          .array(z.string())
          .min(1)
          .describe("Task ids in their new order. Omitted tasks fall to the back."),
      },
    },
    async ({ order }) => {
      const { state, result, eventCursor } = await withFarm(store, (farm) => {
        const byId = new Map(farm.wren.queue.map((task) => [task.id, task]));
        const unknown = order.filter((id) => !byId.has(id));
        const promoted: QueuedTask[] = [];
        for (const id of order) {
          const task = byId.get(id);
          if (task) {
            promoted.push(task);
            byId.delete(id);
          }
        }
        farm.wren.queue = [...promoted, ...byId.values()];
        return { unknown, length: farm.wren.queue.length };
      });

      const summary =
        result.unknown.length > 0
          ? `Reordered the queue; ignored ${result.unknown.length} unknown task id(s): ${result.unknown.join(", ")}.`
          : `Reordered ${result.length} queued task(s).`;

      return buildResult(state, {
        summary,
        eventCursor,
        awaySummary: takeAwaySummary(state),
        extra: { unknownIds: result.unknown },
      });
    },
  );
}

/* --------------------------------------------------------------- commerce -- */

function registerBuySupplies(server: McpServer, store: FarmStore): void {
  const ids = SHOP_ITEMS.map((item) => item.id);
  registerFarmViewTool(
    server,
    "buy_supplies",
    {
      title: "Buy from the supply shop",
      description:
        "Buys seeds, animal feed, or livestock. Delivery is instant and costs Wren no time, so " +
        "this never needs a task.\n\n" +
        `Items: ${ids.join(", ")}. Feed is cheaper in lots of 10. Animals are limited by housing ` +
        "(6 chickens in the coop, 3 cows in the barn).\n\n" +
        "Call get_almanac for prices and payback times. If the purse is short, or the coop is " +
        "full, this returns an error explaining exactly what is wrong — pass that back to the " +
        "player instead of retrying.",
      inputSchema: {
        item: z.string().describe(`What to buy. One of: ${ids.join(", ")}.`),
        quantity: z.number().int().positive().describe("How many to buy."),
      },
    },
    async ({ item, quantity }) => {
      const { state, result, eventCursor } = await withFarm(store, (farm) =>
        buySupplies(farm, item, quantity),
      );

      if (!result.ok) {
        return refusal(result.reason, { state: snapshot(state) });
      }

      return buildResult(state, {
        summary: `Bought ${result.qty} x ${result.itemId} for ${result.cost}g. ${state.gold}g left.`,
        eventCursor,
        awaySummary: takeAwaySummary(state),
        extra: {
          purchased: result.itemId,
          quantity: result.qty,
          cost: result.cost,
          gold: state.gold,
          ...(result.names ? { names: result.names } : {}),
        },
      });
    },
  );
}

function registerListCustomers(server: McpServer, store: FarmStore): void {
  registerFarmViewTool(
    server,
    "list_waiting_customers",
    {
      title: "See who is at the stand",
      description:
        "Lists the customers currently waiting at the farm stand: name, what they want, what " +
        "they're offering, how many game-minutes of patience they have left, and — importantly — " +
        "whether the stand can actually fill their order right now. If it can't, the response " +
        "names what is short so you can queue a restock task before they give up and walk " +
        "(which costs reputation).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { state, eventCursor } = await withFarm(store, () => undefined);
      const snap = snapshot(state);

      const summary =
        snap.customers.length === 0
          ? "Nobody is at the stand right now."
          : `${snap.customers.length} customer(s) waiting at the stand.`;

      return buildResult(state, {
        summary,
        eventCursor,
        awaySummary: takeAwaySummary(state),
        extra: { customers: snap.customers },
      });
    },
  );
}

function registerSellToCustomer(server: McpServer, store: FarmStore): void {
  registerFarmViewTool(
    server,
    "sell_to_customer",
    {
      title: "Sell to a waiting customer",
      description:
        "Completes a sale. Pass `accept: true` to take the customer's offer, which always works " +
        "if the stand has the goods. Or pass `counterPrice` to haggle: each customer has a " +
        "private ceiling, and a counter within it earns more gold. Push too far and they " +
        "usually refuse — and sometimes walk out, costing reputation.\n\n" +
        "Goods come off the FARM STAND, not barn storage. If the stand is short, this returns " +
        "what is missing so you can queue a restock task; the customer keeps waiting meanwhile.\n\n" +
        "Accepting the asking price is the safe play and still builds reputation. Haggle when " +
        "the player asks you to, or when a basket looks clearly underpriced.",
      inputSchema: {
        customerId: z
          .string()
          .describe('Customer id from list_waiting_customers, or simply their name ("Marta").'),
        accept: z
          .boolean()
          .optional()
          .describe("True to accept their offer as-is. Ignored if counterPrice is given."),
        counterPrice: z
          .number()
          .positive()
          .optional()
          .describe("Ask this price instead of their offer. Risky above their hidden ceiling."),
      },
    },
    async ({ customerId, accept, counterPrice }) => {
      if (counterPrice === undefined && accept !== true) {
        return refusal(
          "Say how to close the sale: either accept: true to take their offer, or counterPrice to haggle.",
        );
      }

      const { state, result, eventCursor } = await withFarm(store, (farm) =>
        sellToCustomer(farm, customerId, counterPrice),
      );

      switch (result.kind) {
        case "no_such_customer":
          return refusal(
            `No customer called "${customerId}" is at the stand. They may have already left — call list_waiting_customers.`,
          );

        case "missing_goods":
          return refusal(
            `The stand can't fill that order — it is short ${result.missing
              .map((m) => describeGood(m.good, m.qty))
              .join(
                " and ",
              )}. Queue a restock task to carry stock over from the barn; they are still waiting.`,
            { missing: result.missing, state: snapshot(state) },
          );

        case "declined":
          return buildResult(state, {
            summary: result.message,
            eventCursor,
            awaySummary: takeAwaySummary(state),
            extra: { outcome: "declined", customerId: result.customer.id },
          });

        case "walked_out":
          return buildResult(state, {
            summary: `${result.customer.name} refused and walked off (${result.reputationDelta} reputation).`,
            eventCursor,
            wrenLine: wrenLine(state, "customerLeft"),
            awaySummary: takeAwaySummary(state),
            extra: {
              outcome: "walked_out",
              customerId: result.customer.id,
              reputationDelta: result.reputationDelta,
            },
          });

        case "sold":
          return buildResult(state, {
            summary: `Sold to ${result.customer.name} for ${result.price}g (+${result.reputationDelta} reputation). The tin holds ${state.gold}g.`,
            eventCursor,
            wrenLine: wrenLine(state, "sale"),
            awaySummary: takeAwaySummary(state),
            extra: {
              outcome: "sold",
              customerId: result.customer.id,
              price: result.price,
              reputationDelta: result.reputationDelta,
              gold: state.gold,
            },
          });
      }
    },
  );
}

/* ------------------------------------------------------------------- meta -- */

function registerRename(server: McpServer, store: FarmStore): void {
  registerFarmViewTool(
    server,
    "rename",
    {
      title: "Rename Wren or an animal",
      description:
        'Renames the farmhand or any animal. Use who: "wren" for the farmhand, or an animal id ' +
        'or current name ("Nugget") for an animal. Purely cosmetic, and exactly the kind of ' +
        "thing players like to do — take the request at face value.",
      inputSchema: {
        who: z.string().describe('"wren", or an animal id or name.'),
        name: z.string().min(1).max(40).describe("The new name."),
      },
    },
    async ({ who, name }) => {
      const { state, result, eventCursor } = await withFarm(store, (farm) => {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false as const, reason: "That name is empty." };

        if (who.toLowerCase() === "wren" || who.toLowerCase() === farm.wren.name.toLowerCase()) {
          const previous = farm.wren.name;
          farm.wren.name = trimmed;
          return { ok: true as const, kind: "wren" as const, previous, next: trimmed };
        }

        const animal = findAnimal(farm, who);
        if (!animal) {
          return {
            ok: false as const,
            reason: `Nobody on the farm is called "${who}". Use "wren", or an animal's id or name.`,
          };
        }
        const previous = animal.name;
        animal.name = trimmed;
        return { ok: true as const, kind: "animal" as const, previous, next: trimmed };
      });

      if (!result.ok) return refusal(result.reason);

      return buildResult(state, {
        summary: `${result.previous} is now called ${result.next}.`,
        eventCursor,
        awaySummary: takeAwaySummary(state),
        extra: { renamed: result.kind, previousName: result.previous, newName: result.next },
      });
    },
  );
}

function registerNewFarm(server: McpServer, store: FarmStore): void {
  registerFarmViewTool(
    server,
    "new_farm",
    {
      title: "Start over with a fresh farm",
      description:
        "Wipes this farm and starts a brand-new one: 500g, a few seeds, one chicken, twelve " +
        "untilled plots. Everything the player has built is destroyed and cannot be recovered, " +
        "so only call this when they have clearly and deliberately asked to start over. " +
        "Requires confirm: true.",
      inputSchema: {
        confirm: z
          .boolean()
          .describe(
            "Must be true. Guards against wiping a farm on a casual mention of restarting.",
          ),
        wrenName: z.string().min(1).max(40).optional().describe("Name for the new farmhand."),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ confirm, wrenName }) => {
      if (!confirm) {
        return refusal(
          "new_farm needs confirm: true. This destroys the current farm permanently — check the player really means it first.",
        );
      }

      const now = store.now();
      const fresh: FarmState = createFarm(makeSeed(now ^ 0x5eed), now);
      if (wrenName) fresh.wren.name = wrenName.trim() || DEFAULT_WREN_NAME;
      await store.write(fresh);

      return buildResult(fresh, {
        summary: `A brand-new farm, with ${fresh.gold}g and a lot of untilled soil. ${fresh.wren.name} is waiting by the farmhouse.`,
        eventCursor: 0,
        extra: { reset: true, map: mapDescription() },
      });
    },
  );
}

/** Re-exported so the almanac tool and tests can render the same prose. */
export { describeFarm, snapshot };
export { GOOD_IDS, fulfillment, patienceRemaining };
