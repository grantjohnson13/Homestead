import { afterEach, describe, expect, it } from "vitest";
import { MAP_HEIGHT, MAP_WIDTH } from "../../src/data/map.ts";
import { farmTime } from "../../src/sim/index.ts";
import { MockHost } from "./host.ts";
import { fixtureState } from "./fixture.ts";
import type { FarmSnapshot } from "../../src/tools/snapshot.ts";

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

function hrefsIn(host: MockHost, selector: string): string[] {
  return Array.from(host.document.querySelectorAll(`${selector} use`)).map(
    (node) => node.getAttribute("href") ?? "",
  );
}

describe("the board", () => {
  it("draws one ground tile per map square", async () => {
    const h = await mount();
    const board = h.document.querySelector("svg.board");
    expect(board).not.toBeNull();

    const groundLayer = board?.firstElementChild;
    expect(groundLayer?.children.length).toBe(MAP_WIDTH * MAP_HEIGHT);
  });

  it("uses the right viewBox for a 16x12 farm at 24px tiles", async () => {
    const h = await mount();
    expect(h.document.querySelector("svg.board")?.getAttribute("viewBox")).toBe("0 0 384 288");
  });

  it("places every building", async () => {
    const h = await mount();
    const all = Array.from(h.document.querySelectorAll("svg.board use")).map((n) =>
      n.getAttribute("href"),
    );
    for (const id of ["#b-farmhouse", "#b-coop", "#b-barn", "#b-stand", "#b-well"]) {
      expect(all, id).toContain(id);
    }
  });

  it("draws fences around the edge", async () => {
    const h = await mount();
    const fences = Array.from(h.document.querySelectorAll("svg.board use")).filter(
      (n) => n.getAttribute("href") === "#t-fence",
    );
    // The perimeter of a 16x12 grid.
    expect(fences.length).toBe(2 * MAP_WIDTH + 2 * (MAP_HEIGHT - 2));
  });
});

describe("plots", () => {
  it("shows tilled soil under a planted crop", async () => {
    const state = fixtureState();
    const h = await mount(state);
    expect(hrefsIn(h, "#plots")).toContain("#t-plot-tilled");
  });

  it("shows each crop's own sprite once mature", async () => {
    const state = fixtureState();
    state.plots[0] = {
      ...state.plots[0]!,
      crop: "pumpkin",
      status: "ready",
      stage: "mature",
      progress: 1,
    };
    const h = await mount(state);
    expect(hrefsIn(h, "#plots")).toContain("#c-pumpkin");
  });

  it("sparkles over a crop that is ready", async () => {
    const state = fixtureState();
    state.plots[0] = { ...state.plots[0]!, crop: "radish", status: "ready", stage: "mature" };
    const h = await mount(state);
    expect(h.document.querySelectorAll("#plots .sparkle").length).toBeGreaterThan(0);
  });

  it("shows seed and sprout stages before maturity", async () => {
    const state = fixtureState();
    state.plots[0] = { ...state.plots[0]!, crop: "corn", status: "growing", stage: "seed" };
    state.plots[1] = { ...state.plots[1]!, crop: "corn", status: "growing", stage: "sprout" };
    const h = await mount(state);

    const hrefs = hrefsIn(h, "#plots");
    expect(hrefs).toContain("#c-seed");
    expect(hrefs).toContain("#c-sprout");
  });

  it("darkens watered soil", async () => {
    const state = fixtureState();
    state.plots[0] = { ...state.plots[0]!, watered: true, status: "growing", crop: "corn" };
    const h = await mount(state);
    expect(hrefsIn(h, "#plots")).toContain("#t-plot-wet");
  });

  it("leaves an empty plot bare", async () => {
    const state = fixtureState();
    for (const plot of state.plots) {
      Object.assign(plot, { crop: null, status: "empty", watered: false, stage: null });
    }
    const h = await mount(state);
    expect(hrefsIn(h, "#plots")).toEqual([]);
  });
});

describe("Wren", () => {
  it("uses the facing-specific sprite", async () => {
    for (const [facing, sprite] of [
      ["up", "#ch-wren-up"],
      ["down", "#ch-wren-down"],
      ["left", "#ch-wren-side"],
      ["right", "#ch-wren-side"],
    ] as const) {
      const state = fixtureState();
      state.wren = { ...state.wren, facing };
      const h = await mount(state);
      expect(hrefsIn(h, "#actors"), facing).toContain(sprite);
      h.close();
      host = null;
    }
  });

  it("mirrors the side view when walking left", async () => {
    const state = fixtureState();
    state.wren = { ...state.wren, facing: "left" };
    const h = await mount(state);

    const sprite = Array.from(h.document.querySelectorAll("#actors use")).find(
      (n) => n.getAttribute("href") === "#ch-wren-side",
    );
    expect(sprite?.getAttribute("transform")).toContain("scale(-1,1)");
  });

  it("is positioned at her tile", async () => {
    const state = fixtureState();
    state.wren = { ...state.wren, x: 5, y: 4 };
    const h = await mount(state);

    const actors = Array.from(h.document.querySelectorAll("#actors .actor"));
    const transforms = actors.map((n) => n.getAttribute("transform"));
    expect(transforms).toContain("translate(120,96)"); // 5*24, 4*24
  });

  it("shows a walking class while travelling", async () => {
    const state = fixtureState();
    state.wren = {
      ...state.wren,
      currentTask: { type: "water", target: "plot_1", action: "walking" },
    };
    const h = await mount(state);
    expect(h.document.querySelector("#actors .actor")?.getAttribute("class")).toContain("walking");
  });

  it("shows a tool icon for what she is doing", async () => {
    const cases: [string, string][] = [
      ["till", "#ic-hoe"],
      ["water", "#ic-can"],
      ["harvest", "#ic-basket"],
      ["feed", "#ic-feed"],
      ["pet", "#ic-heart"],
      ["load", "#ic-box"],
    ];
    for (const [action, icon] of cases) {
      const state = fixtureState();
      state.wren = { ...state.wren, exhausted: false, currentTask: { type: action, action } };
      const h = await mount(state);
      expect(hrefsIn(h, "#actors"), action).toContain(icon);
      h.close();
      host = null;
    }
  });

  it("shows a splash while watering", async () => {
    const state = fixtureState();
    state.wren = {
      ...state.wren,
      currentTask: { type: "water", target: "plot_1", action: "water" },
    };
    const h = await mount(state);
    expect(h.document.querySelectorAll("#actors .splash").length).toBe(1);
  });

  it("shows the goods she is carrying", async () => {
    const state = fixtureState();
    state.wren = {
      ...state.wren,
      carrying: [{ good: "tomato", qty: 4 }],
      currentTask: { type: "restock", action: "walking" },
    };
    const h = await mount(state);
    expect(h.document.querySelectorAll("#actors .carried").length).toBe(1);
  });

  it("shows nothing carried when her hands are empty", async () => {
    const state = fixtureState();
    state.wren = { ...state.wren, carrying: [] };
    const h = await mount(state);
    expect(h.document.querySelectorAll("#actors .carried").length).toBe(0);
  });

  it("shows she is asleep on her feet when exhausted", async () => {
    const state = fixtureState();
    state.wren = { ...state.wren, exhausted: true, currentTask: null };
    const h = await mount(state);
    expect(hrefsIn(h, "#actors")).toContain("#ic-zzz");
  });
});

describe("animals and customers", () => {
  it("draws each animal with its own sprite", async () => {
    const h = await mount();
    const hrefs = hrefsIn(h, "#actors");
    expect(hrefs).toContain("#a-chicken");
    expect(hrefs).toContain("#a-cow");
  });

  it("hearts a happy animal and marks a grumpy one", async () => {
    const state = fixtureState();
    state.animals = [
      { ...state.animals[0]!, id: "c1", mood: "happy", ready: 0 },
      { ...state.animals[0]!, id: "c2", mood: "grumpy", ready: 0 },
    ];
    const h = await mount(state);
    const hrefs = hrefsIn(h, "#actors");
    expect(hrefs).toContain("#ic-heart");
    expect(hrefs).toContain("#ic-zzz");
  });

  it("sparkles an animal with produce waiting", async () => {
    const state = fixtureState();
    state.animals = [{ ...state.animals[0]!, ready: 2, mood: "content" }];
    const h = await mount(state);
    expect(h.document.querySelectorAll("#actors .sparkle").length).toBeGreaterThan(0);
  });

  it("draws a patience ring for each customer", async () => {
    const state = fixtureState();
    state.customers = [
      {
        id: "cu1",
        name: "Marta",
        portrait: 0,
        wants: [{ good: "egg", qty: 2, label: "2 eggs" }],
        yourPrice: 40,
        affordable: true,
        patienceLeft: 5,
        patienceTotal: 10,
        x: 7,
        y: 10,
        canFulfill: true,
        missing: [],
      },
    ];
    const h = await mount(state);

    const ring = h.document.querySelector("#actors .patience-ring");
    expect(ring).not.toBeNull();
    // Half the patience spent means half the ring's circumference is offset.
    const circumference = 2 * Math.PI * 8;
    expect(Number(ring?.getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference * 0.5, 3);
  });

  it("removes a customer who has left", async () => {
    const withCustomer = fixtureState();
    withCustomer.customers = [
      {
        id: "cu1",
        name: "Marta",
        portrait: 1,
        wants: [{ good: "egg", qty: 1, label: "1 egg" }],
        yourPrice: 20,
        affordable: true,
        patienceLeft: 9,
        patienceTotal: 10,
        x: 7,
        y: 10,
        canFulfill: false,
        missing: ["1 egg"],
      },
    ];
    const h = await mount(withCustomer);
    expect(hrefsIn(h, "#actors")).toContain("#ch-customer");

    const gone = { ...withCustomer, customers: [] };
    h.render(gone);
    expect(hrefsIn(h, "#actors")).not.toContain("#ch-customer");
  });
});

describe("the side panel and ticker", () => {
  it("shows Wren's name, stamina and current job", async () => {
    const state = fixtureState();
    state.wren = {
      ...state.wren,
      name: "Rowan",
      stamina: 42,
      exhausted: false,
      currentTask: { type: "till", target: "plot_3", action: "till" },
    };
    const h = await mount(state);

    expect(h.document.getElementById("wren-name")?.textContent).toBe("Rowan");
    expect(h.document.getElementById("wren-stamina")?.textContent).toBe("42%");
    expect(h.document.getElementById("wren-doing")?.textContent).toContain("plot 3");
  });

  it("colours the stamina bar by how tired she is", async () => {
    const state = fixtureState();
    state.wren = { ...state.wren, stamina: 10 };
    const h = await mount(state);
    expect(h.document.getElementById("stamina-bar")?.className).toContain("low");
  });

  it("lists the task queue in order", async () => {
    const state = fixtureState();
    state.wren = {
      ...state.wren,
      queue: [
        { id: "t1", type: "till", target: "plot_1" },
        { id: "t2", type: "plant", target: "plot_1", crop: "corn" },
      ],
    };
    const h = await mount(state);

    const items = Array.from(h.document.querySelectorAll("#queue li"));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("till");
    expect(items[1]?.textContent).toContain("corn");
  });

  it("says so when the queue is empty", async () => {
    const state = fixtureState();
    state.wren = { ...state.wren, queue: [] };
    const h = await mount(state);
    expect(h.document.querySelector("#queue .empty")?.textContent).toContain("empty");
  });

  it("lists waiting customers with whether the stand can serve them", async () => {
    const state = fixtureState();
    state.customers = [
      {
        id: "cu1",
        name: "Sunni",
        portrait: 2,
        wants: [{ good: "tomato", qty: 2, label: "2 tomatoes" }],
        yourPrice: 95,
        affordable: true,
        patienceLeft: 7,
        patienceTotal: 10,
        x: 7,
        y: 10,
        canFulfill: true,
        missing: [],
      },
    ];
    const h = await mount(state);

    const card = h.document.querySelector("#customers .cust");
    expect(card?.textContent).toContain("Sunni");
    expect(card?.textContent).toContain("2 tomatoes");
    expect(card?.querySelector(".ok")?.textContent).toContain("buying now");
  });

  it("says when a customer is blocked by price rather than by stock", async () => {
    const state = fixtureState();
    state.customers = [
      {
        id: "cu1",
        name: "Toft",
        portrait: 8,
        wants: [{ good: "egg", qty: 2, label: "2 eggs" }],
        yourPrice: 400,
        affordable: false,
        patienceLeft: 90,
        patienceTotal: 150,
        x: 7,
        y: 10,
        canFulfill: true,
        missing: [],
      },
    ];
    const h = await mount(state);
    expect(h.document.querySelector("#customers .short")?.textContent).toContain(
      "price is too high",
    );
  });

  it("shows the price list against the market reference", async () => {
    const state = fixtureState();
    state.prices = [
      { good: "radish", yourPrice: 40, referencePrice: 25 },
      { good: "egg", yourPrice: 20, referencePrice: 28 },
    ];
    const h = await mount(state);

    const over = h.document.querySelector("#prices .chip.over");
    const under = h.document.querySelector("#prices .chip.under");
    expect(over?.textContent).toContain("40g");
    expect(over?.getAttribute("title")).toContain("premium");
    expect(under?.textContent).toContain("20g");
    expect(under?.getAttribute("title")).toContain("undercutting");
  });

  it("shows lost sales and what they would have paid", async () => {
    const state = fixtureState();
    state.lostSales = [
      {
        at: 100,
        customer: "Toft",
        reason: "price",
        wanted: "2 eggs",
        yourPrice: 90,
        theirMax: 44,
        missing: [],
      },
      {
        at: 120,
        customer: "Fen",
        reason: "stock",
        wanted: "2 radishes",
        yourPrice: 50,
        theirMax: 60,
        missing: ["2 radishes"],
      },
    ];
    const h = await mount(state);

    const text = h.document.getElementById("lost-sales")?.textContent ?? "";
    expect(text).toContain("Toft");
    expect(text).toContain("they'd have paid 44g");
    expect(text).toContain("Fen");
    expect(text).toContain("stand was short");
  });

  it("says so when nobody has left empty-handed", async () => {
    const state = fixtureState();
    state.lostSales = [];
    const h = await mount(state);
    expect(h.document.querySelector("#lost-sales .empty")?.textContent).toContain(
      "Nobody has left",
    );
  });

  it("shows what is on the stand and what is in the barn", async () => {
    const state = fixtureState();
    state.stand = { egg: 3, radish: 2 };
    state.inventory = { tomato: 5, radish_seed: 4, feed: 9 };
    state.customers = [];
    const h = await mount(state);

    const stand = h.document.getElementById("stand-stock")?.textContent ?? "";
    expect(stand).toContain("3 eggs");
    expect(stand).toContain("2 radishes");

    const barn = h.document.getElementById("barn-stock")?.textContent ?? "";
    expect(barn).toContain("5 tomatoes");
    // Seeds and feed are supplies, not sellable goods.
    expect(barn).not.toContain("seed");
    expect(barn).not.toContain("feed");
  });

  it("says so when the stand is bare", async () => {
    const state = fixtureState();
    state.stand = {};
    const h = await mount(state);
    expect(h.document.querySelector("#stand-stock .empty")?.textContent).toContain("Nothing");
  });

  it("highlights a good someone is asking for", async () => {
    const state = fixtureState();
    state.stand = { egg: 4, pumpkin: 1 };
    state.customers = [
      {
        id: "cu1",
        name: "Marta",
        portrait: 0,
        wants: [{ good: "egg", qty: 2, label: "2 eggs" }],
        yourPrice: 40,
        affordable: true,
        patienceLeft: 100,
        patienceTotal: 150,
        x: 7,
        y: 10,
        canFulfill: true,
        missing: [],
      },
    ];
    const h = await mount(state);

    const wanted = h.document.querySelectorAll("#stand-stock .chip.wanted");
    expect(wanted).toHaveLength(1);
    expect(wanted[0]?.textContent).toContain("eggs");
  });

  it("flags a good stuck in the barn while a customer waits for it", async () => {
    const state = fixtureState();
    state.stand = {};
    state.inventory = { radish: 6 };
    state.customers = [
      {
        id: "cu1",
        name: "Fen",
        portrait: 4,
        wants: [{ good: "radish", qty: 2, label: "2 radishes" }],
        yourPrice: 47,
        affordable: true,
        patienceLeft: 40,
        patienceTotal: 150,
        x: 8,
        y: 10,
        canFulfill: false,
        missing: ["2 radishes"],
      },
    ];
    const h = await mount(state);

    // This is the exact failure that cost two customers in real play: the goods
    // existed, but they were in the barn instead of on the counter.
    const needed = h.document.querySelectorAll("#barn-stock .chip.needed");
    expect(needed).toHaveLength(1);
    expect(needed[0]?.textContent).toContain("radishes");
    expect(needed[0]?.getAttribute("title")).toContain("restock");
  });

  it("counts the stand's goods on the board itself", async () => {
    const state = fixtureState();
    state.stand = { egg: 3, radish: 2 };
    const h = await mount(state);

    const badge = h.document.querySelector("#plots .stand-badge");
    const count = h.document.querySelector("#plots .stand-count");
    expect(badge).not.toBeNull();
    expect(count?.textContent).toBe("5");
  });

  it("draws no badge when the stand is empty", async () => {
    const state = fixtureState();
    state.stand = {};
    const h = await mount(state);
    expect(h.document.querySelector("#plots .stand-badge")).toBeNull();
  });

  it("shows the gold, reputation and clock", async () => {
    const state = fixtureState();
    state.gold = 777;
    state.reputation = 61;
    state.clock = 125;
    state.time = farmTime(125);
    const h = await mount(state);

    expect(h.document.getElementById("stat-gold")?.textContent).toBe("777");
    expect(h.document.getElementById("stat-rep")?.textContent).toBe("61");
    // Farms start at 6am, so 125 minutes in is a little after eight.
    expect(h.document.getElementById("stat-clock")?.textContent).toBe("Day 1 · 08:05");
  });

  it("shows the certificate once it is earned", async () => {
    const state = fixtureState();
    state.certificates = ["best_farm_in_the_valley"];
    const h = await mount(state);

    const cert = h.document.getElementById("cert");
    expect(cert?.style.display).not.toBe("none");
    expect(cert?.textContent).toContain("Best Farm");
  });

  it("tickers the most recent event", async () => {
    const state = fixtureState();
    state.recentEvents = [
      { at: 1, kind: "crop", text: "old news" },
      { at: 2, kind: "customer", text: "Marta arrived at the stand" },
    ];
    const h = await mount(state);
    expect(h.document.getElementById("ticker-line")?.textContent).toBe(
      "Marta arrived at the stand",
    );
  });
});

describe("tooltips", () => {
  it("puts a hit area over every plot, animal and customer", async () => {
    const state = fixtureState();
    const h = await mount(state);

    const hits = h.document.querySelectorAll("#hits .tile-hit");
    expect(hits.length).toBe(state.plots.length + state.animals.length + state.customers.length);
  });

  it("makes hit areas keyboard reachable", async () => {
    const h = await mount();
    const first = h.document.querySelector("#hits .tile-hit");
    expect(first?.getAttribute("tabindex")).toBe("0");
  });
});
