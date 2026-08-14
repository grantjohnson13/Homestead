import { beforeAll, describe, expect, it } from "vitest";
import { newGame, type GameHarness, type ToolResponse } from "./harness.ts";

/**
 * M2's acceptance test: a complete game played entirely through MCP tool calls.
 * Nothing here touches the simulation directly — if this passes, the tool
 * surface is genuinely sufficient to play.
 */
describe("a full playthrough via tool calls only", () => {
  let game: GameHarness;
  const log: string[] = [];

  beforeAll(async () => {
    game = await newGame();
  });

  function record(label: string, response: ToolResponse) {
    log.push(`${label}: ${response.summary}`);
    return response;
  }

  it("exposes the whole documented tool surface", async () => {
    const tools = await game.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "assign_tasks",
        "buy_supplies",
        "clear_task_queue",
        "get_almanac",
        "get_farm_state",
        "list_waiting_customers",
        "new_farm",
        "rename",
        "reorder_task_queue",
        "sell_to_customer",
      ].sort(),
    );
  });

  it("starts on a fresh farm with 500 gold", async () => {
    const response = record("look", await game.call("get_farm_state"));
    expect(response.state.gold).toBe(500);
    expect(response.state.plots).toHaveLength(12);
    expect(response.state.animals).toHaveLength(1);
    expect(response.data["map"]).toBeDefined();
    expect(response.text).toContain("Field:");
  });

  it("buys seed from the shop", async () => {
    const response = record(
      "buy",
      await game.call("buy_supplies", { item: "radish_seed", quantity: 6 }),
    );
    expect(response.isError).toBe(false);
    expect(response.state.gold).toBeLessThan(500);
    expect(response.state.inventory["radish_seed"]).toBeGreaterThanOrEqual(6);
  });

  it("queues a batch of work and accepts all of it", async () => {
    const response = record(
      "assign",
      await game.call("assign_tasks", {
        tasks: [
          { type: "till", target: "plot_1" },
          { type: "plant", target: "plot_1", crop: "radish" },
          { type: "water", target: "plot_1" },
          { type: "till", target: "plot_2" },
          { type: "plant", target: "plot_2", crop: "radish" },
          { type: "water", target: "plot_2" },
          { type: "feed", target: "all_chickens" },
        ],
      }),
    );

    expect(response.isError).toBe(false);
    expect(response.data["rejectedCount"]).toBe(0);
    const assigned = response.data["assigned"] as { accepted: boolean }[];
    expect(assigned).toHaveLength(7);
    expect(assigned.every((a) => a.accepted)).toBe(true);
    expect(response.state.wren.queue.length).toBeGreaterThan(0);
  });

  it("lets time pass and reports what happened", async () => {
    game.passTime(45);
    const response = record("wait", await game.call("get_farm_state"));

    expect(response.state.clock).toBeGreaterThanOrEqual(45);
    expect(response.events.length).toBeGreaterThan(0);
    // The crops should have been sown and watered by now.
    const planted = response.state.plots.filter((p) => p.crop !== null);
    expect(planted.length).toBe(2);
  });

  it("harvests once the radishes are ready", async () => {
    game.passTime(40);
    await game.call("get_farm_state");

    const ready = (await game.call("get_farm_state")).state.plots.filter(
      (p) => p.status === "ready",
    );
    expect(ready.length).toBeGreaterThan(0);

    record(
      "harvest",
      await game.call("assign_tasks", {
        tasks: ready.map((p) => ({ type: "harvest", target: p.id })),
      }),
    );

    game.passTime(40);
    const after = record("post-harvest", await game.call("get_farm_state"));
    const barnRadishes = after.state.inventory["radish"] ?? 0;
    expect(barnRadishes).toBeGreaterThan(0);
  });

  it("restocks the stand from the barn", async () => {
    record(
      "restock",
      await game.call("assign_tasks", { tasks: [{ type: "restock", target: "all" }] }),
    );
    game.passTime(40);

    const response = record("post-restock", await game.call("get_farm_state"));
    const onStand = Object.values(response.state.stand).reduce((sum, n) => sum + n, 0);
    expect(onStand).toBeGreaterThan(0);
  });

  it("brings a customer to the stand and sells to them", async () => {
    let customerId: string | null = null;

    // Customers arrive on a timer; give them a while to show up.
    for (let i = 0; i < 40 && !customerId; i++) {
      game.passTime(10);
      const waiting = await game.call("list_waiting_customers");
      const customers = waiting.state.customers;
      const fillable = customers.find((c) => c.canFulfill);
      if (fillable) customerId = fillable.id;
    }

    expect(customerId, "a fillable customer should have arrived").not.toBeNull();

    const before = (await game.call("get_farm_state")).state;
    const sale = record(
      "sell",
      await game.call("sell_to_customer", { customerId: customerId as string, accept: true }),
    );

    expect(sale.isError).toBe(false);
    expect(sale.data["outcome"]).toBe("sold");
    expect(sale.state.gold).toBeGreaterThan(before.gold);
    expect(sale.state.reputation).toBeGreaterThanOrEqual(before.reputation);
  });

  it("has produced a coherent narrative log", () => {
    expect(log.length).toBeGreaterThan(5);
    expect(log.every((line) => line.length > 0)).toBe(true);
  });
});

describe("tool-level error handling", () => {
  it("explains a rejected task instead of failing the call", async () => {
    const game = await newGame();
    const response = await game.call("assign_tasks", {
      tasks: [{ type: "plant", target: "plot_1", crop: "radish" }],
    });

    expect(response.isError).toBe(false); // the call succeeded; the task did not
    expect(response.data["rejectedCount"]).toBe(1);
    const assigned = response.data["assigned"] as { accepted: boolean; reason?: string }[];
    expect(assigned[0]?.accepted).toBe(false);
    expect(assigned[0]?.reason).toContain("tilled first");
  });

  it("accepts the good half of a mixed batch", async () => {
    const game = await newGame();
    const response = await game.call("assign_tasks", {
      tasks: [
        { type: "till", target: "plot_1" },
        { type: "water", target: "plot_9" },
        { type: "till", target: "plot_2" },
      ],
    });

    const assigned = response.data["assigned"] as { accepted: boolean }[];
    expect(assigned.map((a) => a.accepted)).toEqual([true, false, true]);
    expect(response.state.wren.queue).toHaveLength(2);
  });

  it("refuses to overspend and says why", async () => {
    const game = await newGame();
    const response = await game.call("buy_supplies", { item: "cow", quantity: 2 });

    expect(response.isError).toBe(true);
    expect(response.text).toContain("tin holds 500g");
  });

  it("refuses an unknown shop item", async () => {
    const game = await newGame();
    const response = await game.call("buy_supplies", { item: "helicopter", quantity: 1 });
    expect(response.isError).toBe(true);
    expect(response.text).toContain("doesn't stock");
  });

  it("refuses to sell to a customer who isn't there", async () => {
    const game = await newGame();
    const response = await game.call("sell_to_customer", { customerId: "nobody", accept: true });
    expect(response.isError).toBe(true);
    expect(response.text).toContain("No customer called");
  });

  it("insists on knowing how to close a sale", async () => {
    const game = await newGame();
    const response = await game.call("sell_to_customer", { customerId: "anyone" });
    expect(response.isError).toBe(true);
    expect(response.text).toContain("accept: true");
  });

  it("says what the stand is short when an order cannot be filled", async () => {
    const game = await newGame();
    await game.call("get_farm_state");
    await game.poke((state) => {
      state.customers.push({
        id: "customer_1",
        name: "Marta",
        portrait: 0,
        wants: [{ good: "pumpkin", qty: 2 }],
        offer: 400,
        tolerance: 500,
        arrivedAt: state.clock,
        patience: 10,
        spot: { x: 7, y: 10 },
      });
    });

    const response = await game.call("sell_to_customer", {
      customerId: "customer_1",
      accept: true,
    });
    expect(response.isError).toBe(true);
    expect(response.text).toContain("short 2 pumpkins");
    expect(response.text).toContain("restock");
  });
});

describe("queue management", () => {
  it("clears pending work", async () => {
    const game = await newGame();
    await game.call("assign_tasks", {
      tasks: [
        { type: "till", target: "plot_1" },
        { type: "till", target: "plot_2" },
        { type: "till", target: "plot_3" },
      ],
    });

    const response = await game.call("clear_task_queue");
    expect(response.state.wren.queue).toHaveLength(0);
    expect(response.data["dropped"]).toBeGreaterThan(0);
  });

  it("replaces the queue when asked", async () => {
    const game = await newGame();
    await game.call("assign_tasks", {
      tasks: [
        { type: "till", target: "plot_1" },
        { type: "till", target: "plot_2" },
      ],
    });
    const response = await game.call("assign_tasks", {
      tasks: [{ type: "till", target: "plot_5" }],
      mode: "replace",
    });

    const targets = response.state.wren.queue.map((t) => t.target);
    expect(targets).toEqual(["plot_5"]);
  });

  it("promotes a task to the front", async () => {
    const game = await newGame();
    const assigned = await game.call("assign_tasks", {
      tasks: [
        { type: "till", target: "plot_1" },
        { type: "till", target: "plot_2" },
        { type: "till", target: "plot_3" },
      ],
    });
    const ids = (assigned.data["assigned"] as { taskId: string }[]).map((a) => a.taskId);
    const last = ids[2] as string;

    const response = await game.call("reorder_task_queue", { order: [last] });
    expect(response.state.wren.queue[0]?.id).toBe(last);
    expect(response.state.wren.queue).toHaveLength(3);
  });

  it("ignores unknown ids in a reorder rather than erroring", async () => {
    const game = await newGame();
    await game.call("assign_tasks", { tasks: [{ type: "till", target: "plot_1" }] });
    const response = await game.call("reorder_task_queue", { order: ["nope"] });

    expect(response.isError).toBe(false);
    expect(response.data["unknownIds"]).toEqual(["nope"]);
    expect(response.state.wren.queue).toHaveLength(1);
  });
});

describe("meta tools", () => {
  it("renames the farmhand", async () => {
    const game = await newGame();
    const response = await game.call("rename", { who: "wren", name: "Rowan" });
    expect(response.state.wren.name).toBe("Rowan");
    expect(response.summary).toContain("Rowan");
  });

  it("renames an animal by its current name", async () => {
    const game = await newGame();
    const before = (await game.call("get_farm_state")).state.animals[0];
    const response = await game.call("rename", {
      who: before?.name as string,
      name: "Sir Clucksalot",
    });
    expect(response.state.animals[0]?.name).toBe("Sir Clucksalot");
  });

  it("refuses to rename someone who doesn't exist", async () => {
    const game = await newGame();
    const response = await game.call("rename", { who: "Gerald", name: "Bob" });
    expect(response.isError).toBe(true);
  });

  it("refuses to reset without explicit confirmation", async () => {
    const game = await newGame();
    await game.call("buy_supplies", { item: "radish_seed", quantity: 1 });
    const response = await game.call("new_farm", { confirm: false });

    expect(response.isError).toBe(true);
    expect(response.text).toContain("confirm: true");
    expect((await game.call("get_farm_state")).state.gold).toBeLessThan(500);
  });

  it("resets the farm when confirmed", async () => {
    const game = await newGame();
    await game.call("buy_supplies", { item: "radish_seed", quantity: 3 });
    const response = await game.call("new_farm", { confirm: true, wrenName: "Juniper" });

    expect(response.state.gold).toBe(500);
    expect(response.state.wren.name).toBe("Juniper");
    expect(response.state.plots.every((p) => p.status === "empty")).toBe(true);
  });

  it("serves the almanac without touching the farm", async () => {
    const game = await newGame();
    const response = await game.call("get_almanac");
    expect(response.text).toContain("HOMESTEAD ALMANAC");
    expect((response.data["crops"] as unknown[]).length).toBe(6);
  });
});
