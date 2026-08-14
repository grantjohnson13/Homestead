/*
  Homestead farm view.

  Runs inside the host's app iframe with zero dependencies and zero network
  access beyond the postMessage bridge. The MCP Apps client below is hand-rolled
  against the wire protocol rather than pulling in the SDK, because the whole
  page has to ship as one self-contained HTML string (see DECISIONS.md).

  The view is a *view*: it never mutates the farm. Everything it draws comes from
  get_farm_state, and it must be able to rebuild itself completely from a single
  such call, because the host may unmount and recreate this iframe at any time.
*/

(function () {
  "use strict";

  /* Injected at build time from src/data — one source of truth for the map. */
  var EMBED = window.__HOMESTEAD__ || { map: { art: [], width: 16, height: 12 }, crops: {} };

  var TILE = 24;
  var PROTOCOL_VERSION = "2026-01-26";
  var POLL_VISIBLE_MS = 2000;
  var POLL_HIDDEN_MS = 15000;
  var MAX_BACKOFF_MS = 30000;

  /* =====================================================================
     MCP Apps client
     ===================================================================== */

  var nextRequestId = 1;
  var pending = new Map();
  var handshakeDone = false;
  var hostContext = null;

  /*
    The host injects messages that are not JSON-RPC at all (auth frames shaped
    like {type, token, payload}, for instance). Anything without jsonrpc:"2.0"
    must be ignored silently — never thrown on, or the listener dies and the
    iframe goes deaf. This mirrors what the official PostMessageTransport does.
  */
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.jsonrpc !== "2.0") return;

    try {
      if (typeof msg.method === "string") {
        if (msg.id === undefined || msg.id === null) handleNotification(msg);
        else handleRequest(msg);
        return;
      }
      if (msg.id !== undefined && msg.id !== null) handleResponse(msg);
    } catch (err) {
      // A malformed frame must never take the view down.
      log("message handler error", err);
    }
  });

  function post(message) {
    window.parent.postMessage(message, "*");
  }

  function request(method, params) {
    var id = nextRequestId++;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
      setTimeout(function () {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(method + " timed out"));
        }
      }, 20000);
    });
  }

  function notify(method, params) {
    post({ jsonrpc: "2.0", method: method, params: params || {} });
  }

  function respond(id, result) {
    post({ jsonrpc: "2.0", id: id, result: result });
  }

  function handleResponse(msg) {
    var entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message || "request failed"));
    else entry.resolve(msg.result);
  }

  function handleRequest(msg) {
    switch (msg.method) {
      case "ping":
        respond(msg.id, {});
        return;
      case "ui/resource-teardown":
        teardown();
        respond(msg.id, {});
        return;
      default:
        // Unknown requests still need an answer, or the host may stall.
        respond(msg.id, {});
    }
  }

  function handleNotification(msg) {
    var params = msg.params || {};
    switch (msg.method) {
      case "ui/notifications/tool-result":
        applyToolResult(params);
        return;
      case "ui/notifications/tool-input":
      case "ui/notifications/tool-input-partial":
        // Nothing to do: the farm is server-authoritative, so we wait for the
        // result rather than speculating from the arguments.
        return;
      case "ui/notifications/tool-cancelled":
        return;
      case "ui/notifications/host-context-changed":
        applyHostContext(params);
        return;
      default:
        return;
    }
  }

  /*
    Handlers are registered above before connect() runs, because the host may
    deliver tool-result the moment the handshake completes — registering
    afterwards races it away.

    Nothing host-bound may be called before ui/initialize resolves; doing so can
    leave the iframe permanently hidden on strict hosts.
  */
  function connect() {
    return request("ui/initialize", {
      appInfo: { name: "homestead-farm-view", version: "1.0.0" },
      appCapabilities: {},
      protocolVersion: PROTOCOL_VERSION,
    }).then(function (result) {
      if (result && result.hostContext) applyHostContext(result.hostContext);
      notify("ui/notifications/initialized");
      handshakeDone = true;
      reportSize();
    });
  }

  function callServerTool(name, args) {
    if (!handshakeDone) return Promise.reject(new Error("not connected"));
    return request("tools/call", { name: name, arguments: args || {} });
  }

  var lastSize = { w: 0, h: 0 };
  function reportSize() {
    if (!handshakeDone) return;
    var root = document.documentElement;
    var w = Math.ceil(window.innerWidth);
    var h = Math.ceil(root.getBoundingClientRect().height);
    if (w === lastSize.w && h === lastSize.h) return;
    lastSize = { w: w, h: h };
    notify("ui/notifications/size-changed", { width: w, height: h });
  }

  /* =====================================================================
     Host context: theme and safe areas
     ===================================================================== */

  function applyHostContext(ctx) {
    if (!ctx || typeof ctx !== "object") return;
    hostContext = Object.assign({}, hostContext, ctx);

    if (ctx.theme === "dark" || ctx.theme === "light") {
      document.documentElement.setAttribute("data-theme", ctx.theme);
    }

    if (ctx.styles && typeof ctx.styles === "object") {
      var vars = ctx.styles.cssVariables || ctx.styles;
      for (var key in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, key) && key.indexOf("--") === 0) {
          var value = vars[key];
          if (typeof value === "string") document.documentElement.style.setProperty(key, value);
        }
      }
    }

    var inset = ctx.safeAreaInsets;
    if (inset && typeof inset === "object") {
      var s = document.documentElement.style;
      s.setProperty("--safe-top", (inset.top || 0) + "px");
      s.setProperty("--safe-right", (inset.right || 0) + "px");
      s.setProperty("--safe-bottom", (inset.bottom || 0) + "px");
      s.setProperty("--safe-left", (inset.left || 0) + "px");
    }
  }

  /* =====================================================================
     State plumbing
     ===================================================================== */

  var farm = null;
  var pollTimer = null;
  var backoffMs = 0;
  var stopped = false;

  function applyToolResult(params) {
    var structured = params && params.structuredContent;
    if (structured && structured.state) {
      setFarm(structured.state);
      // A tool call just changed the world; keep watching it closely.
      backoffMs = 0;
      schedulePoll(POLL_VISIBLE_MS);
    }
  }

  function setFarm(next) {
    var first = farm === null;
    farm = next;
    render(first);
    markFresh();
  }

  function pollInterval() {
    var base = document.visibilityState === "hidden" ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
    return Math.max(base, backoffMs);
  }

  function schedulePoll(delay) {
    if (stopped) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, delay === undefined ? pollInterval() : delay);
  }

  function poll() {
    if (stopped || !handshakeDone) {
      schedulePoll();
      return;
    }
    callServerTool("get_farm_state", {})
      .then(function (result) {
        var structured = result && result.structuredContent;
        if (structured && structured.state) {
          setFarm(structured.state);
          backoffMs = 0;
        }
        schedulePoll();
      })
      .catch(function (err) {
        log("poll failed", err);
        markStale();
        // Ease off a struggling server rather than hammering it.
        backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs ? backoffMs * 2 : 4000);
        schedulePoll();
      });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      backoffMs = 0;
      schedulePoll(0);
    } else {
      schedulePoll();
    }
  });

  function teardown() {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    pending.clear();
  }

  function log() {
    if (window.console && console.debug) {
      console.debug.apply(console, ["[homestead]"].concat([].slice.call(arguments)));
    }
  }

  /* =====================================================================
     Static board
     ===================================================================== */

  var GROUND_FOR_CHAR = {
    f: "t-fence",
    ".": "t-grass",
    "#": "t-path",
    P: "t-plot-raw",
    H: "t-grass",
    C: "t-grass",
    B: "t-grass",
    S: "t-grass",
    W: "t-grass",
  };

  var BUILDINGS = [
    { char: "H", symbol: "b-farmhouse", w: 2, h: 2, label: "Farmhouse" },
    { char: "C", symbol: "b-coop", w: 2, h: 2, label: "Coop" },
    { char: "B", symbol: "b-barn", w: 2, h: 2, label: "Barn & storage" },
    { char: "S", symbol: "b-stand", w: 2, h: 1, label: "Farm stand" },
    { char: "W", symbol: "b-well", w: 1, h: 1, label: "Well" },
  ];

  var SVG_NS = "http://www.w3.org/2000/svg";

  function svg(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
          node.setAttribute(key, String(attrs[key]));
        }
      }
    }
    return node;
  }

  function useSprite(id, x, y, size) {
    var node = svg("use", {
      x: x,
      y: y,
      width: size || TILE,
      height: size || TILE,
    });
    node.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#" + id);
    node.setAttribute("href", "#" + id);
    return node;
  }

  /** Top-left corner of each building, discovered from the map art. */
  function buildingOrigin(ch) {
    var art = EMBED.map.art;
    for (var y = 0; y < art.length; y++) {
      var x = art[y].indexOf(ch);
      if (x >= 0) return { x: x, y: y };
    }
    return null;
  }

  function buildBoard() {
    var art = EMBED.map.art;
    var width = EMBED.map.width * TILE;
    var height = EMBED.map.height * TILE;

    var board = svg("svg", {
      class: "board",
      viewBox: "0 0 " + width + " " + height,
      role: "img",
      "aria-label": "Top-down view of the farm",
    });

    var ground = svg("g");
    for (var y = 0; y < art.length; y++) {
      for (var x = 0; x < art[y].length; x++) {
        var id = GROUND_FOR_CHAR[art[y][x]] || "t-grass";
        ground.appendChild(useSprite(id, x * TILE, y * TILE));
      }
    }
    board.appendChild(ground);

    var structures = svg("g");
    BUILDINGS.forEach(function (b) {
      var origin = buildingOrigin(b.char);
      if (!origin) return;
      var node = useSprite(b.symbol, origin.x * TILE, origin.y * TILE);
      node.setAttribute("width", b.w * TILE);
      node.setAttribute("height", b.h * TILE);
      structures.appendChild(node);
    });
    board.appendChild(structures);

    var plotLayer = svg("g", { id: "plots" });
    var actorLayer = svg("g", { id: "actors" });
    var hitLayer = svg("g", { id: "hits" });
    board.appendChild(plotLayer);
    board.appendChild(actorLayer);
    board.appendChild(hitLayer);

    return { board: board, plots: plotLayer, actors: actorLayer, hits: hitLayer };
  }

  /* =====================================================================
     Dynamic rendering
     ===================================================================== */

  var layers = null;
  var actorNodes = new Map();

  var CROP_SYMBOL = {
    radish: "c-radish",
    lettuce: "c-lettuce",
    tomato: "c-tomato",
    corn: "c-corn",
    strawberry: "c-strawberry",
    pumpkin: "c-pumpkin",
  };

  var ACTION_ICON = {
    till: "ic-hoe",
    plant: "ic-basket",
    water: "ic-can",
    refill: "ic-can",
    harvest: "ic-basket",
    collect: "ic-basket",
    feed: "ic-feed",
    pet: "ic-heart",
    load: "ic-box",
    unload: "ic-box",
    rest: "ic-zzz",
  };

  var CUSTOMER_PALETTE = [
    ["#7b8bbd", "#6b4f33", "#f2c9a0"],
    ["#8a9a5b", "#4a4038", "#e8bb90"],
    ["#c98b7a", "#8a5a3b", "#f6d5b4"],
    ["#6ba3a0", "#3c3630", "#d9a778"],
    ["#b7869c", "#7a5c3e", "#f2c9a0"],
    ["#8f7bbd", "#5a4a3c", "#e0b48c"],
    ["#c2a05a", "#4d3b2a", "#f6d5b4"],
    ["#7fa87b", "#6b4f33", "#d9a778"],
    ["#a8787a", "#2f2a26", "#f2c9a0"],
    ["#6d8fbd", "#8a6a45", "#e8bb90"],
    ["#b58a5c", "#4a4038", "#f6d5b4"],
    ["#87a2c9", "#6b4f33", "#e0b48c"],
  ];

  function render(isFirst) {
    if (!farm) return;
    if (!layers) return;

    renderPlots();
    renderStandBadge();
    renderActors(isFirst);
    renderHud();
    renderSide();
    renderTicker();
    reportSize();
  }

  function renderPlots() {
    var layer = layers.plots;
    layer.textContent = "";

    farm.plots.forEach(function (plot) {
      var px = plot.x * TILE;
      var py = plot.y * TILE;

      if (plot.status !== "empty") {
        layer.appendChild(useSprite("t-plot-tilled", px, py));
      }
      if (plot.watered) {
        layer.appendChild(useSprite("t-plot-wet", px, py));
      }

      if (plot.crop) {
        var symbol;
        if (plot.status === "ready") symbol = CROP_SYMBOL[plot.crop] || "c-growing";
        else if (plot.stage === "seed") symbol = "c-seed";
        else if (plot.stage === "sprout") symbol = "c-sprout";
        else symbol = "c-growing";

        var sprite = useSprite(symbol, px, py);
        // Growing plants tint toward their crop so the field reads at a glance.
        if (plot.status !== "ready" && plot.stage === "growing") {
          sprite.setAttribute("opacity", "0.95");
        }
        layer.appendChild(sprite);

        if (plot.status === "ready") {
          var sparkle = useSprite("fx-sparkle", px + 8, py - 4, 14);
          sparkle.setAttribute("class", "sparkle");
          layer.appendChild(sparkle);
        }
      }
    });
  }

  /**
   * A count of goods sitting on the counter, drawn over the stand itself, so
   * "can I serve anyone?" is answerable at a glance from the board alone.
   */
  function renderStandBadge() {
    var layer = layers.plots;
    var stand = farm.stand || {};
    var total = 0;
    Object.keys(stand).forEach(function (id) {
      total += stand[id];
    });
    if (total <= 0) return;

    var origin = buildingOrigin("S");
    if (!origin) return;

    var cx = origin.x * TILE + TILE;
    var cy = origin.y * TILE - 2;

    var badge = svg("circle", { class: "stand-badge", cx: cx, cy: cy, r: 6.5 });
    var label = svg("text", {
      class: "stand-count",
      x: cx,
      y: cy + 3.2,
      "text-anchor": "middle",
    });
    label.textContent = String(total);

    layer.appendChild(badge);
    layer.appendChild(label);
  }

  /**
   * Actors are kept as persistent nodes keyed by id, so their CSS transition can
   * interpolate movement between polls instead of restarting every frame.
   */
  function renderActors(isFirst) {
    var seen = new Set();
    var moveMs = pollInterval();

    // --- Wren ---
    var wren = farm.wren;
    var wrenNode = ensureActor("wren", function () {
      var g = svg("g", { class: "actor" });
      g.appendChild(useSprite("fx-shadow", 0, 0));
      var body = svg("g", { class: "body" });
      g.appendChild(body);
      var icon = svg("g", { class: "icon" });
      g.appendChild(icon);
      return g;
    });
    seen.add("wren");

    var facing = wren.facing;
    var symbol =
      facing === "up" ? "ch-wren-up" : facing === "down" ? "ch-wren-down" : "ch-wren-side";
    var body = wrenNode.querySelector(".body");
    body.textContent = "";
    var wrenSprite = useSprite(symbol, 0, 0);
    if (facing === "left") {
      // The side view is drawn facing right; mirror it in place for left.
      wrenSprite.setAttribute("transform", "translate(24,0) scale(-1,1)");
    }
    body.appendChild(wrenSprite);

    var task = wren.currentTask;
    var iconHolder = wrenNode.querySelector(".icon");
    iconHolder.textContent = "";
    if (wren.exhausted) {
      var zzz = useSprite("ic-zzz", 12, -10, 13);
      zzz.setAttribute("class", "action-icon");
      iconHolder.appendChild(zzz);
    } else if (task && ACTION_ICON[task.action]) {
      var icon = useSprite(ACTION_ICON[task.action], 12, -10, 13);
      icon.setAttribute("class", "action-icon");
      iconHolder.appendChild(icon);
    }

    // Carried goods ride along at her side, so a restock trip reads as a trip.
    if (wren.carrying && wren.carrying.length > 0) {
      var crate = useSprite("ic-box", -6, 8, 12);
      crate.setAttribute("class", "carried");
      iconHolder.appendChild(crate);
    }

    var walking = !!(task && task.action === "walking");
    var working = !!(task && task.action !== "walking");
    wrenNode.setAttribute(
      "class",
      "actor" + (walking ? " walking" : "") + (working ? " working" : ""),
    );
    placeActor(wrenNode, wren.x, wren.y, moveMs, isFirst);

    // Watering leaves a splash behind.
    if (task && (task.action === "water" || task.action === "refill")) {
      var splash = useSprite("fx-droplet", wren.x * TILE + 4, wren.y * TILE + 2, 12);
      splash.setAttribute("class", "splash");
      layers.actors.appendChild(splash);
      splash.dataset.transient = "1";
    }

    // --- Animals ---
    var coop = buildingOrigin("C");
    var barn = buildingOrigin("B");
    var chickenN = 0;
    var cowN = 0;

    farm.animals.forEach(function (animal) {
      var key = "animal:" + animal.id;
      seen.add(key);
      var isChicken = animal.kind === "chicken";
      var home = isChicken ? coop : barn;
      if (!home) return;
      var index = isChicken ? chickenN++ : cowN++;
      var spot = animalSpot(home, index, isChicken);

      var node = ensureActor(key, function () {
        var g = svg("g", { class: "actor" });
        g.appendChild(useSprite("fx-shadow", 0, 0));
        g.appendChild(useSprite(isChicken ? "a-chicken" : "a-cow", 0, 0));
        g.appendChild(svg("g", { class: "mood" }));
        return g;
      });

      var mood = node.querySelector(".mood");
      mood.textContent = "";
      if (animal.mood === "happy") {
        var heart = useSprite("ic-heart", 13, -6, 11);
        heart.setAttribute("class", "action-icon");
        mood.appendChild(heart);
      } else if (animal.mood === "grumpy") {
        var grump = useSprite("ic-zzz", 13, -6, 11);
        grump.setAttribute("class", "action-icon");
        grump.setAttribute("opacity", "0.85");
        mood.appendChild(grump);
      }
      if (animal.ready > 0) {
        var ready = useSprite("fx-sparkle", 0, -5, 11);
        ready.setAttribute("class", "sparkle");
        mood.appendChild(ready);
      }

      placeActor(node, spot.x, spot.y, moveMs, isFirst);
    });

    // --- Customers ---
    farm.customers.forEach(function (customer) {
      var key = "customer:" + customer.id;
      seen.add(key);
      var palette = CUSTOMER_PALETTE[customer.portrait % CUSTOMER_PALETTE.length];

      var node = ensureActor(key, function () {
        var g = svg("g", { class: "actor" });
        g.appendChild(useSprite("fx-shadow", 0, 0));
        var person = useSprite("ch-customer", 0, 0);
        g.appendChild(person);
        g.appendChild(svg("g", { class: "ring" }));
        return g;
      });

      node.style.setProperty("--cust-body", palette[0]);
      node.style.setProperty("--cust-hair", palette[1]);
      node.style.setProperty("--cust-skin", palette[2]);

      // Patience ring: a circle that empties as their goodwill runs out.
      var ring = node.querySelector(".ring");
      ring.textContent = "";
      var fraction = customer.patienceTotal
        ? Math.max(0, Math.min(1, customer.patienceLeft / customer.patienceTotal))
        : 0;
      var radius = 8;
      var circumference = 2 * Math.PI * radius;
      var track = svg("circle", {
        cx: 12,
        cy: -4,
        r: radius,
        fill: "none",
        stroke: "rgba(0,0,0,0.18)",
        "stroke-width": 2.4,
      });
      var arc = svg("circle", {
        class: "patience-ring",
        cx: 12,
        cy: -4,
        r: radius,
        fill: "none",
        stroke: fraction > 0.5 ? "#5aa860" : fraction > 0.25 ? "#d9a441" : "#d1584e",
        "stroke-width": 2.4,
        "stroke-linecap": "round",
        "stroke-dasharray": circumference,
        "stroke-dashoffset": circumference * (1 - fraction),
        transform: "rotate(-90 12 -4)",
      });
      ring.appendChild(track);
      ring.appendChild(arc);
      if (customer.canFulfill) {
        var tick = useSprite("ic-basket", 18, -12, 10);
        tick.setAttribute("class", "action-icon");
        ring.appendChild(tick);
      }

      placeActor(node, customer.x, customer.y, moveMs, isFirst);
    });

    // Drop anyone who has left, plus last frame's one-shot effects.
    actorNodes.forEach(function (node, key) {
      if (!seen.has(key)) {
        node.remove();
        actorNodes.delete(key);
      }
    });
    Array.prototype.slice
      .call(layers.actors.querySelectorAll("[data-transient]"))
      .forEach(function (node, index, all) {
        // Keep only the splash added this frame (the last one).
        if (index < all.length - 1) node.remove();
      });

    renderHits();
  }

  function ensureActor(key, create) {
    var node = actorNodes.get(key);
    if (!node) {
      node = create();
      actorNodes.set(key, node);
      layers.actors.appendChild(node);
      node.dataset.fresh = "1";
    }
    return node;
  }

  function placeActor(node, tileX, tileY, moveMs, isFirst) {
    var transform = "translate(" + tileX * TILE + "," + tileY * TILE + ")";
    var isNew = node.dataset.fresh === "1";
    if (isNew || isFirst) {
      node.classList.add("no-transition");
      node.setAttribute("transform", transform);
      // Force layout so the next change animates from here rather than 0,0.
      void node.getBoundingClientRect();
      node.classList.remove("no-transition");
      delete node.dataset.fresh;
      return;
    }
    node.style.setProperty("--move-ms", moveMs + "ms");
    node.setAttribute("transform", transform);
  }

  /** Animals mill about near their building on a small deterministic spread. */
  function animalSpot(origin, index, isChicken) {
    var offsets = isChicken
      ? [
          [-1, 2],
          [0, 2.4],
          [1, 2],
          [-1.4, 1.2],
          [1.4, 1.3],
          [0.2, 1.1],
        ]
      : [
          [-1.4, 2.2],
          [0.2, 2.5],
          [1.6, 2.1],
        ];
    var offset = offsets[index % offsets.length];
    return { x: origin.x + offset[0], y: origin.y + offset[1] };
  }

  /* =====================================================================
     Tooltips
     ===================================================================== */

  var tip = null;

  function renderHits() {
    var layer = layers.hits;
    layer.textContent = "";

    farm.plots.forEach(function (plot) {
      addHit(layer, plot.x * TILE, plot.y * TILE, TILE, TILE, plotTip(plot));
    });

    var coop = buildingOrigin("C");
    var barn = buildingOrigin("B");
    var chickenN = 0;
    var cowN = 0;
    farm.animals.forEach(function (animal) {
      var isChicken = animal.kind === "chicken";
      var home = isChicken ? coop : barn;
      if (!home) return;
      var spot = animalSpot(home, isChicken ? chickenN++ : cowN++, isChicken);
      addHit(layer, spot.x * TILE, spot.y * TILE, TILE, TILE, animalTip(animal));
    });

    farm.customers.forEach(function (customer) {
      addHit(layer, customer.x * TILE, customer.y * TILE, TILE, TILE, customerTip(customer));
    });
  }

  function addHit(layer, x, y, w, h, text) {
    var rect = svg("rect", { class: "tile-hit", x: x, y: y, width: w, height: h, tabindex: 0 });
    rect.addEventListener("pointerenter", function (event) {
      showTip(text, event.clientX, event.clientY);
    });
    rect.addEventListener("pointermove", function (event) {
      showTip(text, event.clientX, event.clientY);
    });
    rect.addEventListener("pointerleave", hideTip);
    rect.addEventListener("focus", function () {
      var box = rect.getBoundingClientRect();
      showTip(text, box.left + box.width / 2, box.top);
    });
    rect.addEventListener("blur", hideTip);
    layer.appendChild(rect);
  }

  function plotTip(plot) {
    var lines = ["<b>" + escapeHtml(plot.id.replace("_", " ")) + "</b>"];
    if (!plot.crop) {
      lines.push(plot.status === "tilled" ? "Tilled and ready to sow." : "Untilled ground.");
    } else {
      var name = (EMBED.crops[plot.crop] && EMBED.crops[plot.crop].name) || plot.crop;
      lines.push(escapeHtml(name) + " — " + escapeHtml(plot.stage || ""));
      lines.push(Math.round(plot.progress * 100) + "% grown");
      if (plot.status === "ready") lines.push('<span class="muted">Ready to harvest.</span>');
      else if (!plot.watered)
        lines.push('<span class="muted">Dry — growth has stalled.</span>');
      else lines.push('<span class="muted">' + plot.moisture + "m of water left.</span>");
      if (plot.harvestsLeft > 1) {
        lines.push('<span class="muted">' + plot.harvestsLeft + " harvests left.</span>");
      }
    }
    return lines.join("<br>");
  }

  function animalTip(animal) {
    return [
      "<b>" + escapeHtml(animal.name) + "</b>",
      escapeHtml(animal.kind) + " — " + escapeHtml(animal.mood),
      animal.fed ? "Fed." : '<span class="muted">Hungry.</span>',
      animal.ready > 0
        ? animal.ready + " " + escapeHtml(animal.produces) + " to collect"
        : '<span class="muted">Nothing to collect yet.</span>',
    ].join("<br>");
  }

  function customerTip(customer) {
    var wants = customer.wants
      .map(function (w) {
        return escapeHtml(w.label);
      })
      .join(", ");
    return [
      "<b>" + escapeHtml(customer.name) + "</b>",
      "Wants " + wants,
      "Offering " + customer.offer + "g",
      customer.patienceLeft + "m patience left",
      customer.canFulfill
        ? '<span class="muted">The stand can fill this.</span>'
        : '<span class="muted">Short: ' + escapeHtml(customer.missing.join(", ")) + "</span>",
    ].join("<br>");
  }

  function showTip(html, clientX, clientY) {
    if (!tip) return;
    tip.innerHTML = html;
    tip.classList.add("show");
    var box = tip.getBoundingClientRect();
    var x = clientX + 12;
    var y = clientY + 14;
    if (x + box.width > window.innerWidth - 8) x = clientX - box.width - 12;
    if (y + box.height > window.innerHeight - 8) y = clientY - box.height - 12;
    tip.style.left = Math.max(6, x) + "px";
    tip.style.top = Math.max(6, y) + "px";
  }

  function hideTip() {
    if (tip) tip.classList.remove("show");
  }

  /* =====================================================================
     HUD, sidebar, ticker
     ===================================================================== */

  function renderHud() {
    setText("stat-gold", farm.gold);
    setText("stat-rep", farm.reputation);
    // The server computes the day-clock so this and the text fallback agree.
    setText("stat-clock", farm.time ? farm.time.label : "—");

    var cert = document.getElementById("cert");
    var earned = farm.certificates && farm.certificates.length > 0;
    cert.style.display = earned ? "" : "none";
    if (earned) cert.textContent = "Best Farm in the Valley";
  }

  function renderSide() {
    var wren = farm.wren;
    setText("wren-name", wren.name);
    setText("wren-stamina", wren.stamina + "%");

    var bar = document.getElementById("stamina-bar");
    bar.className = "bar" + (wren.stamina < 25 ? " low" : wren.stamina < 55 ? " mid" : "");
    bar.firstElementChild.style.width = Math.max(0, Math.min(100, wren.stamina)) + "%";

    var doing = document.getElementById("wren-doing");
    if (wren.exhausted) {
      doing.textContent = "Worn out — resting before the next job.";
    } else if (wren.currentTask) {
      var t = wren.currentTask;
      doing.textContent =
        t.action === "walking"
          ? "Walking to " + (t.target || t.type) + "…"
          : capitalize(t.action) + (t.target ? " " + t.target.replace("_", " ") : "");
    } else {
      doing.textContent = "Nothing on the list.";
    }

    var queue = document.getElementById("queue");
    queue.textContent = "";
    if (wren.queue.length === 0) {
      var none = document.createElement("li");
      none.className = "empty";
      none.textContent = "Queue is empty";
      queue.appendChild(none);
    } else {
      wren.queue.slice(0, 12).forEach(function (task, i) {
        var li = document.createElement("li");
        li.appendChild(el("span", "n", String(i + 1)));
        li.appendChild(el("span", "what", task.type));
        if (task.target || task.crop) {
          li.appendChild(
            el("span", "where", (task.crop ? task.crop + " → " : "") + (task.target || "")),
          );
        }
        queue.appendChild(li);
      });
      if (wren.queue.length > 12) {
        var more = document.createElement("li");
        more.className = "empty";
        more.textContent = "+" + (wren.queue.length - 12) + " more";
        queue.appendChild(more);
      }
    }

    renderStock();
    renderPrices();
    renderLostSales();

    var list = document.getElementById("customers");
    list.textContent = "";
    if (farm.customers.length === 0) {
      list.appendChild(el("div", "empty", "Nobody at the stand"));
    } else {
      farm.customers.forEach(function (customer) {
        list.appendChild(customerCard(customer));
      });
    }
  }

  /** "3 eggs", "1 pumpkin" — using the plurals embedded from src/data. */
  function describeGood(id, qty) {
    var def = (EMBED.goods && EMBED.goods[id]) || null;
    if (!def) return qty + " " + id;
    return qty + " " + (qty === 1 ? def.name.toLowerCase() : def.plural);
  }

  /**
   * What is on the counter and what is still in the barn.
   *
   * Without this the player cannot tell whether an arriving customer can be
   * served, which is the single thing that decides a sale. Goods someone is
   * asking for are highlighted, and anything sitting in the barn while a
   * customer waits for it out front is flagged — that means "queue a restock".
   */
  function renderStock() {
    var wanted = {};
    farm.customers.forEach(function (customer) {
      customer.wants.forEach(function (want) {
        wanted[want.good] = (wanted[want.good] || 0) + want.qty;
      });
    });

    var stand = farm.stand || {};
    var barn = farm.inventory || {};

    fillChips("stand-stock", stand, "Nothing on the stand", function (good) {
      return wanted[good] ? "wanted" : "";
    });

    // Only goods are worth showing in the barn; seeds and feed are supplies.
    var barnGoods = {};
    Object.keys(barn).forEach(function (id) {
      if (EMBED.goods && EMBED.goods[id]) barnGoods[id] = barn[id];
    });

    fillChips("barn-stock", barnGoods, "Barn is empty", function (good) {
      var short = (wanted[good] || 0) - (stand[good] || 0);
      return short > 0 ? "needed" : "";
    });
  }

  function fillChips(elementId, bag, emptyText, classFor) {
    var host = document.getElementById(elementId);
    if (!host) return;
    host.textContent = "";

    var ids = Object.keys(bag).filter(function (id) {
      return bag[id] > 0;
    });

    if (ids.length === 0) {
      host.appendChild(el("span", "empty", emptyText));
      return;
    }

    ids.sort().forEach(function (id) {
      var extra = classFor(id);
      var chip = el("span", "chip" + (extra ? " " + extra : ""), describeGood(id, bag[id]));
      if (extra === "needed") chip.title = "Someone at the stand wants this — queue a restock.";
      host.appendChild(chip);
    });
  }

  /**
   * The price list, marked against the market reference so it is obvious at a
   * glance where you are charging over or under the going rate.
   */
  function renderPrices() {
    var host = document.getElementById("prices");
    if (!host) return;
    host.textContent = "";

    var prices = farm.prices || [];
    if (prices.length === 0) {
      host.appendChild(el("span", "empty", "No prices set"));
      return;
    }

    prices.forEach(function (entry) {
      var name = (EMBED.goods && EMBED.goods[entry.good] && EMBED.goods[entry.good].name) || entry.good;
      var over = entry.yourPrice > entry.referencePrice;
      var under = entry.yourPrice < entry.referencePrice;
      var chip = el(
        "span",
        "chip" + (over ? " over" : under ? " under" : ""),
        name + " " + entry.yourPrice + "g",
      );
      chip.title =
        "Market reference " +
        entry.referencePrice +
        "g" +
        (over ? " — you are charging a premium" : under ? " — you are undercutting" : "");
      host.appendChild(chip);
    });
  }

  /**
   * Who left without buying, and why. A price walkout also reports what they
   * would have paid, which is how the market becomes learnable.
   */
  function renderLostSales() {
    var host = document.getElementById("lost-sales");
    if (!host) return;
    host.textContent = "";

    var lost = (farm.lostSales || []).slice(-4).reverse();
    if (lost.length === 0) {
      host.appendChild(el("div", "empty", "Nobody has left empty-handed"));
      return;
    }

    lost.forEach(function (entry) {
      var row = el("div", "lost");
      row.appendChild(el("span", "who", entry.customer));
      if (entry.reason === "price") {
        row.appendChild(
          el("span", "why", " wanted " + entry.wanted + " — you asked " + entry.yourPrice + "g"),
        );
        row.appendChild(el("span", "hint", "they'd have paid " + entry.theirMax + "g"));
      } else {
        row.appendChild(el("span", "why", " wanted " + entry.wanted));
        row.appendChild(el("span", "hint", "stand was short " + entry.missing.join(", ")));
      }
      host.appendChild(row);
    });
  }

  function customerCard(customer) {
    var wrap = document.createElement("div");
    wrap.className = "cust";

    var palette = CUSTOMER_PALETTE[customer.portrait % CUSTOMER_PALETTE.length];
    var mini = svg("svg", { viewBox: "0 0 24 24" });
    mini.style.setProperty("--cust-body", palette[0]);
    mini.style.setProperty("--cust-hair", palette[1]);
    mini.style.setProperty("--cust-skin", palette[2]);
    mini.appendChild(useSprite("ch-customer", 0, 0));
    wrap.appendChild(mini);

    var text = document.createElement("div");
    text.appendChild(el("div", "who", customer.name));
    text.appendChild(
      el(
        "div",
        "wants",
        customer.wants
          .map(function (w) {
            return w.label;
          })
          .join(", ") +
          " — " +
          customer.yourPrice +
          "g",
      ),
    );

    var meta = el("div", "meta", customer.patienceLeft + "m left · ");
    var blocked = !customer.canFulfill || !customer.affordable;
    var label = !customer.canFulfill
      ? "short " + customer.missing.join(", ")
      : !customer.affordable
        ? "your price is too high"
        : "buying now";
    meta.appendChild(el("span", blocked ? "short" : "ok", label));
    text.appendChild(meta);
    wrap.appendChild(text);
    return wrap;
  }

  var lastEventText = null;

  function renderTicker() {
    var events = farm.recentEvents || [];
    var latest = events.length > 0 ? events[events.length - 1] : null;
    var line = document.getElementById("ticker-line");
    var text = latest ? latest.text : "All quiet on the farm.";
    if (text !== lastEventText) {
      lastEventText = text;
      // Re-create the node so the slide-in animation replays.
      var fresh = el("span", "line", text);
      line.replaceWith(fresh);
      fresh.id = "ticker-line";
    }
  }

  function markStale() {
    var t = document.getElementById("ticker");
    if (t) t.classList.add("stale");
  }

  function markFresh() {
    var t = document.getElementById("ticker");
    if (t) t.classList.remove("stale");
  }

  /* =====================================================================
     Small helpers
     ===================================================================== */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }

  function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* =====================================================================
     Boot
     ===================================================================== */

  function boot() {
    var mount = document.getElementById("board-mount");
    layers = buildBoard();
    mount.textContent = "";
    mount.appendChild(layers.board);
    tip = document.getElementById("tip");

    window.addEventListener("resize", reportSize);

    connect()
      .then(function () {
        // Only now is it safe to talk to the host.
        return poll();
      })
      .catch(function (err) {
        log("handshake failed", err);
        // Standalone (no host): show the board with whatever we have.
        markStale();
        var loading = document.getElementById("loading");
        if (loading && !farm) {
          loading.textContent = "Waiting for the farm…";
        }
      });
  }

  // Exposed so the standalone fixture page and tests can drive the renderer.
  window.__homesteadRender = function (state) {
    setFarm(state);
  };
  window.__homesteadBoot = boot;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
