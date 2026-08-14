import { afterEach, describe, expect, it } from "vitest";
import { MockHost } from "./host.ts";
import { fixtureState } from "./fixture.ts";
import type { FarmSnapshot } from "../../src/tools/snapshot.ts";

/**
 * The sidebar outgrew the farm beside it. Tabs keep everything reachable
 * without scrolling past three cards to find the one you wanted — and the alert
 * dots exist so a collapsed section can still say it needs attention.
 */

let host: MockHost | null = null;

afterEach(() => {
  host?.close();
  host = null;
});

async function mount(state?: FarmSnapshot): Promise<MockHost> {
  const created = new MockHost({ autoInitialize: true });
  host = created;
  await created.settle(4);
  created.render(state ?? fixtureState());
  return created;
}

function panel(h: MockHost, name: string): HTMLElement | null {
  return h.document.querySelector(`.panel[data-panel="${name}"]`);
}

function tab(h: MockHost, name: string): HTMLElement | null {
  return h.document.querySelector(`.tab[data-tab="${name}"]`);
}

describe("sidebar tabs", () => {
  it("offers a tab for each group", async () => {
    const h = await mount();
    for (const name of ["wren", "stock", "market", "invest"]) {
      expect(tab(h, name), name).not.toBeNull();
      expect(panel(h, name), name).not.toBeNull();
    }
  });

  it("opens on the farmhand and hides the rest", async () => {
    const h = await mount();
    expect(panel(h, "wren")?.hidden).toBe(false);
    expect(panel(h, "stock")?.hidden).toBe(true);
    expect(panel(h, "market")?.hidden).toBe(true);
    expect(panel(h, "invest")?.hidden).toBe(true);
    expect(tab(h, "wren")?.getAttribute("aria-selected")).toBe("true");
  });

  it("switches panels on click", async () => {
    const h = await mount();
    tab(h, "market")?.click();

    expect(panel(h, "market")?.hidden).toBe(false);
    expect(panel(h, "wren")?.hidden).toBe(true);
    expect(tab(h, "market")?.getAttribute("aria-selected")).toBe("true");
    expect(tab(h, "wren")?.getAttribute("aria-selected")).toBe("false");
  });

  it("keeps the chosen tab across a re-render", async () => {
    const h = await mount();
    tab(h, "invest")?.click();

    h.render(fixtureState());
    expect(panel(h, "invest")?.hidden).toBe(false);
    expect(panel(h, "wren")?.hidden).toBe(true);
  });

  it("still renders hidden panels, so switching is instant", async () => {
    const h = await mount();
    // The invest panel is hidden but populated.
    expect(h.document.querySelectorAll("#upgrades .upgrade").length).toBeGreaterThan(0);
  });
});

describe("tab alerts", () => {
  function customer(overrides: Partial<FarmSnapshot["customers"][number]> = {}) {
    return {
      id: "cu1",
      name: "Marta",
      portrait: 0,
      wants: [{ good: "egg", qty: 2, label: "2 eggs" }],
      yourPrice: 56,
      patienceLeft: 90,
      patienceTotal: 150,
      x: 7,
      y: 10,
      canFulfill: true,
      affordable: true,
      missing: [] as string[],
      ...overrides,
    };
  }

  it("flags the market tab when someone cannot be served", async () => {
    const state = fixtureState();
    state.customers = [customer({ canFulfill: false, missing: ["2 eggs"] })];
    const h = await mount(state);

    expect(tab(h, "market")?.querySelector(".alert")?.hidden).toBe(false);
  });

  it("flags the stock tab when goods are stranded in the barn", async () => {
    const state = fixtureState();
    state.stand = {};
    state.inventory = { egg: 6 };
    state.customers = [customer({ canFulfill: false, missing: ["2 eggs"] })];
    const h = await mount(state);

    // The eggs exist; they are just in the wrong place. That is a restock away.
    expect(tab(h, "stock")?.querySelector(".alert")?.hidden).toBe(false);
  });

  it("does not flag stock when the farm simply has none", async () => {
    const state = fixtureState();
    state.stand = {};
    state.inventory = {};
    state.customers = [customer({ canFulfill: false, missing: ["2 eggs"] })];
    const h = await mount(state);

    expect(tab(h, "stock")?.querySelector(".alert")?.hidden).toBe(true);
  });

  it("flags the invest tab in green when something is affordable", async () => {
    const state = fixtureState();
    state.gold = 100000;
    const h = await mount(state);

    const dot = tab(h, "invest")?.querySelector(".alert");
    expect(dot?.hidden).toBe(false);
    expect(dot?.className).toContain("good");
  });

  it("leaves the invest tab quiet when nothing is affordable", async () => {
    const state = fixtureState();
    state.gold = 0;
    const h = await mount(state);

    expect(tab(h, "invest")?.querySelector(".alert")?.hidden).toBe(true);
  });

  it("stays quiet on a calm farm", async () => {
    const state = fixtureState();
    state.gold = 0;
    state.customers = [];
    const h = await mount(state);

    for (const name of ["stock", "market", "invest"]) {
      expect(tab(h, name)?.querySelector(".alert")?.hidden, name).toBe(true);
    }
  });
});
