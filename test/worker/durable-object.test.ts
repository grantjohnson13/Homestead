import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALARM_INTERVAL_MS } from "../../src/do/farm-do.ts";
import { OFFLINE_CAP_MINUTES, REAL_MS_PER_TICK } from "../../src/sim/constants.ts";
import type { FarmDurableObject } from "../../src/do/farm-do.ts";
import { INIT_MESSAGE, rpc } from "./mcp-client.ts";

function stubFor(key: string): DurableObjectStub<FarmDurableObject> {
  return env.FARM.get(env.FARM.idFromName(key));
}

async function callTool(key: string, name: string, args: Record<string, unknown> = {}) {
  return rpc(`/mcp/${key}`, {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 100000),
    method: "tools/call",
    params: { name, arguments: args },
  });
}

describe("Durable Object: persistence", () => {
  it("creates a farm on first contact and keeps it", async () => {
    const key = "persist-one";
    await callTool(key, "get_farm_state");

    const state = await runInDurableObject(stubFor(key), (instance) => instance.debugState());
    expect(state).not.toBeNull();
    expect(state?.gold).toBe(500);
    expect(state?.plots).toHaveLength(12);
  });

  it("remembers changes across separate requests", async () => {
    const key = "persist-two";
    await callTool(key, "buy_supplies", { item: "radish_seed", quantity: 5 });

    const result = await callTool(key, "get_farm_state");
    const snapshot = (result["structuredContent"] as { state: { gold: number } }).state;
    expect(snapshot.gold).toBeLessThan(500);

    const state = await runInDurableObject(stubFor(key), (instance) => instance.debugState());
    expect(state?.inventory["radish_seed"]).toBeGreaterThanOrEqual(5);
  });

  it("survives the Durable Object being evicted from memory", async () => {
    const key = "persist-evict";
    await callTool(key, "rename", { who: "wren", name: "Rosalind" });

    await evictDurableObject(stubFor(key));

    const state = await runInDurableObject(stubFor(key), (instance) => instance.debugState());
    expect(state?.wren.name).toBe("Rosalind");
  });

  it("keeps farms with different keys completely separate", async () => {
    await callTool("tenant-a", "rename", { who: "wren", name: "Ada" });
    await callTool("tenant-b", "rename", { who: "wren", name: "Grace" });

    const a = await runInDurableObject(stubFor("tenant-a"), (i) => i.debugState());
    const b = await runInDurableObject(stubFor("tenant-b"), (i) => i.debugState());

    expect(a?.wren.name).toBe("Ada");
    expect(b?.wren.name).toBe("Grace");
  });

  it("routes /mcp with no key to the shared demo farm", async () => {
    await rpc("/mcp", INIT_MESSAGE as unknown as Record<string, unknown>);
    await callTool("", "rename", { who: "wren", name: "Demo Hand" });

    const demo = await runInDurableObject(stubFor("demo"), (i) => i.debugState());
    expect(demo?.wren.name).toBe("Demo Hand");
  });
});

describe("Durable Object: the alarm loop", () => {
  it("arms a tick after a request", async () => {
    const key = "alarm-armed";
    await callTool(key, "get_farm_state");

    const alarmAt = await runInDurableObject(stubFor(key), (i) => i.debugAlarmAt());
    expect(alarmAt).not.toBeNull();
    expect(alarmAt as number).toBeLessThanOrEqual(Date.now() + ALARM_INTERVAL_MS + 1000);
  });

  it("advances the world when the alarm fires", async () => {
    const key = "alarm-advance";
    await callTool(key, "get_farm_state");

    // Wind the farm's last-tick marker back so the alarm sees elapsed time.
    // Wall-clock time does not really pass inside the test runtime.
    await runInDurableObject(stubFor(key), async (instance) => {
      const state = await instance.debugState();
      if (!state) throw new Error("no farm");
      state.lastRealMs = Date.now() - 30 * REAL_MS_PER_TICK;
      await instance.debugWrite(state);
    });

    const before = await runInDurableObject(stubFor(key), (i) => i.debugState());
    const ran = await runDurableObjectAlarm(stubFor(key));
    const after = await runInDurableObject(stubFor(key), (i) => i.debugState());

    expect(ran).toBe(true);
    expect(after?.clock).toBeGreaterThan(before?.clock ?? 0);
    expect(after?.clock).toBeGreaterThanOrEqual(30);
  });

  it("re-arms itself while the away budget lasts", async () => {
    const key = "alarm-rearm";
    await callTool(key, "get_farm_state");

    await runDurableObjectAlarm(stubFor(key));

    const alarmAt = await runInDurableObject(stubFor(key), (i) => i.debugAlarmAt());
    expect(alarmAt).not.toBeNull();
  });

  it("stops ticking once the away budget is spent", async () => {
    const key = "alarm-budget";
    await callTool(key, "get_farm_state");

    // Pretend the farm has already ticked away its full two game-hours.
    await runInDurableObject(stubFor(key), async (instance) => {
      const state = await instance.debugState();
      if (!state) throw new Error("no farm");
      state.awayMinutes = OFFLINE_CAP_MINUTES;
      state.lastRealMs = Date.now() - 10 * REAL_MS_PER_TICK;
      await instance.debugWrite(state);
    });

    await runDurableObjectAlarm(stubFor(key));

    const state = await runInDurableObject(stubFor(key), (i) => i.debugState());
    const alarmAt = await runInDurableObject(stubFor(key), (i) => i.debugAlarmAt());

    expect(state?.paused).toBe(true);
    expect(alarmAt).toBeNull();
  });

  it("wakes back up and resets the budget when the player returns", async () => {
    const key = "alarm-resume";
    await callTool(key, "get_farm_state");

    await runInDurableObject(stubFor(key), async (instance) => {
      const state = await instance.debugState();
      if (!state) throw new Error("no farm");
      state.awayMinutes = OFFLINE_CAP_MINUTES;
      state.paused = true;
      await instance.debugWrite(state);
    });

    await callTool(key, "get_farm_state");

    const state = await runInDurableObject(stubFor(key), (i) => i.debugState());
    const alarmAt = await runInDurableObject(stubFor(key), (i) => i.debugAlarmAt());

    expect(state?.paused).toBe(false);
    expect(state?.awayMinutes).toBe(0);
    expect(alarmAt).not.toBeNull();
  });

  it("does not double-spend the away budget between alarms and catch-up", async () => {
    const key = "alarm-nodouble";
    await callTool(key, "get_farm_state");

    // Half the budget burned live by the alarm loop...
    await runInDurableObject(stubFor(key), async (instance) => {
      const state = await instance.debugState();
      if (!state) throw new Error("no farm");
      state.awayMinutes = OFFLINE_CAP_MINUTES / 2;
      // ...and a very long absence on top.
      state.lastRealMs = Date.now() - 10_000 * REAL_MS_PER_TICK;
      await instance.debugWrite(state);
    });

    const before = await runInDurableObject(stubFor(key), (i) => i.debugState());
    await runDurableObjectAlarm(stubFor(key));
    const after = await runInDurableObject(stubFor(key), (i) => i.debugState());

    const advanced = (after?.clock ?? 0) - (before?.clock ?? 0);
    // Only the unspent half of the budget may be simulated.
    expect(advanced).toBe(OFFLINE_CAP_MINUTES / 2);
    expect(after?.paused).toBe(true);
  });

  it("does nothing when an alarm fires on a farm that does not exist", async () => {
    const key = "alarm-empty";
    const stub = stubFor(key);
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm();
    });
    const state = await runInDurableObject(stub, (i) => i.debugState());
    expect(state).toBeNull();
  });
});
