/**
 * The animation layer.
 *
 * These effects are *inferred* from a pair of snapshots rather than announced by
 * the server, so the interesting tests are the inferences: a customer who
 * vanishes has either bought or walked out, and only the lost-sale log says
 * which. Getting that backwards would throw coins for a customer you just lost.
 */

import { afterEach, describe, expect, it } from "vitest";
import { MockHost } from "./host.ts";
import { fixtureState } from "./fixture.ts";
import type { CustomerSnapshot, FarmSnapshot, LostSaleSnapshot } from "../../src/tools/snapshot.ts";

let host: MockHost | null = null;

afterEach(() => {
  host?.close();
  host = null;
});

/** Mounts with `before`, then renders `after`, so the view has a diff to draw. */
async function transition(before: FarmSnapshot, after: FarmSnapshot): Promise<MockHost> {
  const created = new MockHost({ autoInitialize: true });
  host = created;
  await created.settle(4);
  created.render(before);
  created.render(after);
  return created;
}

function customer(overrides: Partial<CustomerSnapshot> = {}): CustomerSnapshot {
  return {
    id: "cu1",
    name: "Marta",
    portrait: 0,
    wants: [{ good: "egg", qty: 2, label: "2 eggs" }],
    yourPrice: 56,
    patienceLeft: 40,
    patienceTotal: 150,
    x: 7,
    y: 10,
    canFulfill: true,
    missing: [],
    affordable: true,
    ...overrides,
  };
}

function lostSale(overrides: Partial<LostSaleSnapshot> = {}): LostSaleSnapshot {
  return {
    at: 300,
    customer: "Marta",
    reason: "price",
    wanted: "2 eggs",
    yourPrice: 56,
    theirMax: 40,
    missing: [],
    ...overrides,
  };
}

describe("the first render", () => {
  it("stays still — the opening balance is not a windfall", async () => {
    const created = new MockHost({ autoInitialize: true });
    host = created;
    await created.settle(4);
    created.render(fixtureState());

    expect(created.document.querySelectorAll("#fx .fx-float")).toHaveLength(0);
    expect(created.document.querySelectorAll("#fx-board *")).toHaveLength(0);
    expect(created.document.querySelectorAll("#actors .actor.pop")).toHaveLength(0);
  });
});

describe("gold and reputation", () => {
  it("floats what was earned over the gold counter", async () => {
    const before = fixtureState();
    const after = { ...before, gold: before.gold + 138 };
    const h = await transition(before, after);

    const float = h.document.querySelector("#fx .fx-float");
    expect(float?.textContent).toBe("+138g");
    expect(float?.className).toContain("gain");
    // The pill itself swells, so the eye goes to the number that moved.
    expect(h.document.getElementById("stat-gold")?.parentElement?.className).toContain("bumped");
  });

  it("marks a purchase as spending, not earning", async () => {
    const before = fixtureState();
    const after = { ...before, gold: before.gold - 250 };
    const h = await transition(before, after);

    const float = h.document.querySelector("#fx .fx-float");
    expect(float?.textContent).toBe("−250g");
    expect(float?.className).toContain("spend");
  });

  it("floats reputation separately from gold", async () => {
    const before = fixtureState();
    const after = { ...before, gold: before.gold + 56, reputation: before.reputation + 4 };
    const h = await transition(before, after);

    const texts = Array.from(h.document.querySelectorAll("#fx .fx-float")).map(
      (n) => n.textContent,
    );
    expect(texts).toContain("+56g");
    expect(texts).toContain("+4★");
  });

  it("says nothing when the tin has not moved", async () => {
    const before = fixtureState();
    const h = await transition(before, { ...before });
    expect(h.document.querySelectorAll("#fx .fx-float")).toHaveLength(0);
  });

  it("keeps only the newest float per stat, so a rush cannot stack them", async () => {
    const before = fixtureState();
    const h = await transition(before, { ...before, gold: before.gold + 10 });
    h.render({ ...before, gold: before.gold + 30 });

    const floats = h.document.querySelectorAll("#fx .fx-float");
    expect(floats).toHaveLength(1);
    expect(floats[0]?.textContent).toBe("+20g");
  });
});

describe("a sale", () => {
  it("throws coins and the takings where the customer stood", async () => {
    const before = fixtureState();
    before.customers = [customer({ x: 7, y: 10, yourPrice: 56 })];

    const after = { ...before, customers: [], gold: before.gold + 56 };
    const h = await transition(before, after);

    const coins = h.document.querySelectorAll("#fx-board .fx-coin");
    expect(coins.length).toBeGreaterThan(0);

    const text = h.document.querySelector("#fx-board .fx-text");
    expect(text?.textContent).toBe("+56g");
    // Centred on their tile: 7 * 24 + 12.
    expect(text?.getAttribute("x")).toBe("180");
  });

  it("nudges the market tab, which may not be the one you are looking at", async () => {
    const before = fixtureState();
    before.customers = [customer()];
    const h = await transition(before, { ...before, customers: [], gold: before.gold + 56 });

    expect(h.document.querySelector('.tab[data-tab="market"]')?.className).toContain("flash");
  });

  it("collapses a rush into one burst over the stand", async () => {
    const before = fixtureState();
    before.customers = [
      customer({ id: "a", name: "A", yourPrice: 10 }),
      customer({ id: "b", name: "B", yourPrice: 20 }),
      customer({ id: "c", name: "C", yourPrice: 30 }),
      customer({ id: "d", name: "D", yourPrice: 40 }),
    ];
    const h = await transition(before, { ...before, customers: [], gold: before.gold + 100 });

    // One total, not four numbers piled on top of each other.
    const texts = Array.from(h.document.querySelectorAll("#fx-board .fx-text")).map(
      (n) => n.textContent,
    );
    expect(texts).toEqual(["+100g"]);
  });
});

describe("a customer who leaves empty-handed", () => {
  it("gets a puff and no coins", async () => {
    const before = fixtureState();
    before.customers = [customer({ name: "Marta" })];
    before.lostSales = [];

    const after = {
      ...before,
      customers: [],
      // Rep drops rather than gold rising: nothing was sold.
      reputation: before.reputation - 1,
      lostSales: [lostSale({ customer: "Marta" })],
    };
    const h = await transition(before, after);

    expect(h.document.querySelectorAll("#fx-board .fx-puff")).toHaveLength(1);
    expect(h.document.querySelectorAll("#fx-board .fx-coin")).toHaveLength(0);
  });

  it("is not confused by an older walkout still in the log", async () => {
    const before = fixtureState();
    before.customers = [customer({ name: "Marta" })];
    // A walkout from earlier, already on the books when this poll started.
    before.lostSales = [lostSale({ at: 100, customer: "Marta" })];

    const after = {
      ...before,
      customers: [],
      gold: before.gold + 56,
      lostSales: [...before.lostSales],
    };
    const h = await transition(before, after);

    // The log did not grow, so Marta bought — coins, not a puff.
    expect(h.document.querySelectorAll("#fx-board .fx-coin").length).toBeGreaterThan(0);
    expect(h.document.querySelectorAll("#fx-board .fx-puff")).toHaveLength(0);
  });
});

describe("the field and the counter", () => {
  it("pops the crop off a plot that was just picked", async () => {
    const before = fixtureState();
    before.plots[0] = { ...before.plots[0]!, crop: "pumpkin", status: "ready", stage: "mature" };

    const after = {
      ...before,
      plots: before.plots.map((p, i) =>
        i === 0 ? { ...p, crop: null, status: "empty" as const, stage: null } : p,
      ),
    };
    const h = await transition(before, after);

    const popped = Array.from(h.document.querySelectorAll("#fx-board .fx-harvest")).map((n) =>
      n.getAttribute("href"),
    );
    expect(popped).toContain("#c-pumpkin");
  });

  it("bumps a stock chip that gained and dims one that sold", async () => {
    const before = fixtureState();
    before.customers = [];
    before.stand = { egg: 2, tomato: 5 };

    const h = await transition(before, { ...before, stand: { egg: 6, tomato: 3 } });

    const chips = Array.from(h.document.querySelectorAll("#stand-stock .chip"));
    const egg = chips.find((c) => c.textContent?.includes("egg"));
    const tomato = chips.find((c) => c.textContent?.includes("tomato"));
    expect(egg?.className).toContain("bump");
    expect(tomato?.className).toContain("drop");
  });

  it("pops the stand's badge when the counter changes", async () => {
    const before = fixtureState();
    before.stand = { egg: 2 };
    const h = await transition(before, { ...before, stand: { egg: 5 } });

    expect(h.document.querySelector("#plots .stand-badge")?.getAttribute("class")).toContain("pop");
  });

  it("leaves the badge alone when nothing moved", async () => {
    const before = fixtureState();
    before.stand = { egg: 2 };
    const h = await transition(before, { ...before });

    expect(h.document.querySelector("#plots .stand-badge")?.getAttribute("class")).not.toContain(
      "pop",
    );
  });
});

describe("an investment", () => {
  it("lights the row and the pip it just earned", async () => {
    const before = fixtureState();
    before.upgrades = before.upgrades.map((u, i) => (i === 0 ? { ...u, level: 1 } : u));

    const after = {
      ...before,
      gold: before.gold - 300,
      upgrades: before.upgrades.map((u, i) => (i === 0 ? { ...u, level: 2, owned: true } : u)),
    };
    const h = await transition(before, after);

    const row = h.document.querySelector("#upgrades .upgrade");
    expect(row?.className).toContain("levelup");

    const fresh = row?.querySelectorAll(".pip.fresh") ?? [];
    expect(fresh).toHaveLength(1);
    // The second pip, which is the level just bought.
    expect(Array.from(row?.querySelectorAll(".pip") ?? []).indexOf(fresh[0]!)).toBe(1);

    expect(h.document.querySelector('.tab[data-tab="invest"]')?.className).toContain("flash");
  });

  it("leaves untouched investments alone", async () => {
    const before = fixtureState();
    const h = await transition(before, { ...before, gold: before.gold - 10 });
    expect(h.document.querySelectorAll("#upgrades .upgrade.levelup")).toHaveLength(0);
  });
});

describe("new arrivals", () => {
  it("pops a customer in, but not the cast already on the farm", async () => {
    const before = fixtureState();
    before.customers = [];

    const h = await transition(before, { ...before, customers: [customer()] });

    const popped = h.document.querySelectorAll("#actors .actor.pop");
    expect(popped).toHaveLength(1);
    expect(popped[0]?.querySelector("use[href='#ch-customer']")).not.toBeNull();
  });
});

describe("housekeeping", () => {
  it("clears every effect when the host tears the view down", async () => {
    const before = fixtureState();
    before.customers = [customer()];
    const h = await transition(before, { ...before, customers: [], gold: before.gold + 56 });

    expect(h.document.querySelectorAll("#fx-board *").length).toBeGreaterThan(0);

    h.requestFromHost(99, "ui/resource-teardown");
    await h.settle();

    expect(h.document.querySelectorAll("#fx-board *")).toHaveLength(0);
    expect(h.document.querySelectorAll("#fx *")).toHaveLength(0);
  });

  it("keeps effects out of the way of the board's hit areas", async () => {
    const h = await transition(fixtureState(), fixtureState());
    const fx = h.document.getElementById("fx-board");
    // Hit areas are drawn after the effects, so hovering a tile still works
    // while coins are flying over it.
    expect(fx?.getAttribute("pointer-events")).toBe("none");
    expect(fx?.nextElementSibling?.id).toBe("hits");
  });
});
