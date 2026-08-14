# PROGRESS

Living milestone checklist. Read before each work session; update after each
meaningful step.

**Status: all six milestones complete.** 322 tests green; typecheck, lint and
format clean. One item outstanding and it is not mockable — see
[Outstanding](#outstanding).

Legend: `[x]` done and demonstrated · `[~]` in progress · `[ ]` not started

---

## M0 — Research & scaffold ✅

- [x] Read current MCP spec / SDK surface (read from installed packages, not docs — see DECISIONS.md)
- [x] Read MCP Apps (SEP-1865) API + wire protocol; extracted exact message set
- [x] Chose hosting + transport (Cloudflare Workers + `WebStandardStreamableHTTPServerTransport`)
- [x] Repo scaffolded: strict TS, ESLint, Prettier, vitest (two projects: `sim` + `worker`)
- [x] Pinned versions recorded in DECISIONS.md
- [x] Hello-world MCP server answers `initialize` + `tools/list`
- [x] `get_almanac` implemented over real crop/animal/shop data
- [x] Farm map authored (16x12) and verified connected by test

**Acceptance:** `npm test` green, transcript below.

```
--> POST /mcp/testfarm
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-01-26","capabilities":{},"clientInfo":{"name":"homestead-test-client","version":"1.0.0"}}}
<-- 200 application/json
{
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "tools": { "listChanged": true }, "resources": {} },
    "serverInfo": { "name": "homestead", "version": "0.1.0" },
    "instructions": "Homestead is a cozy farming game the player plays by talking to you. ..."
  },
  "jsonrpc": "2.0",
  "id": 1
}

--> POST /mcp/testfarm
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
<-- 200 application/json
{
  "result": {
    "tools": [
      {
        "name": "get_almanac", "title": "Read the farm almanac",
        "description": "Static reference data for the whole game: crop economics ...",
        "inputSchema": { "type": "object", "properties": {} },
        "annotations": { "readOnlyHint": true, "openWorldHint": false }
      },
      {
        "name": "get_farm_state", "title": "Look at the farm",
        "_meta": {
          "ui": { "resourceUri": "ui://homestead/farm-view" },
          "ui/resourceUri": "ui://homestead/farm-view"
        }
      }
      // ... 8 more
    ]
  },
  "jsonrpc": "2.0", "id": 2
}
```

The full, unabridged transcript is a checked-in snapshot at
`test/worker/__snapshots__/handshake.txt`, re-verified on every test run, so it
cannot silently drift.

> Note on tooling: `curl` is not available in this build environment, so the
> transcript comes from an integration test driving the identical
> Worker → Durable Object → transport path inside real `workerd` via
> `@cloudflare/vitest-pool-workers`. This is strictly stronger than a curl
> transcript: it runs in CI on every commit.

---

## M1 — Simulation core ✅

- [x] Deterministic RNG + tick loop (no wall-clock reads, no `Math.random()`)
- [x] Plots: till / plant / water / growth stages / stalling / harvest / regrow
- [x] Wren: task queue, BFS pathfinding, walk-and-work legs, stamina
- [x] Animals: feeding windows, mood bands, production, uncollected produce
- [x] Customers: spawning, wants, patience, timeout
- [x] Economy: gold, inventory, stand stock, reputation, certificate
- [x] Well over 40 unit tests covering every rule in §4
- [x] 200-tick "demo day" trajectory test, asserted across four seeds

**Acceptance:** met. The demo-day test also caught a real design bug — customers
were asking for goods the farm had no way to supply, bleeding reputation through
no fault of the player. Fixed at the source (see DECISIONS.md).

## M2 — MCP tools ✅

- [x] `get_farm_state`, `get_almanac`
- [x] `assign_tasks` (batch-validated as a sequence), `clear_task_queue`, `reorder_task_queue`
- [x] `buy_supplies`, `list_waiting_customers`, `sell_to_customer`, `rename`
- [x] `new_farm` (requires `confirm: true`)
- [x] Full scripted playthrough driven only through JSON-RPC tool calls

**Acceptance:** met. The playthrough test caught the event-cursor bug: news from
the gap between calls was being silently dropped — exactly what Claude is meant
to narrate.

## M3 — Durable Object + alarms ✅

- [x] Farm state persisted in DO storage, one DO per farm key
- [x] Alarm loop advances the world between requests
- [x] Offline cap (2 game-hours) + "while you were away" summary
- [x] Persistence, eviction, alarm and budget tests in real `workerd`

**Acceptance:** met. Found and fixed a double-spend: the alarm loop and offline
catch-up each had their own two-hour allowance, so an absence could advance the
world four hours. They now share one budget.

## M4 — Farm view UI ✅

- [x] Inline SVG tile art + sprite sheet (crops per stage, buildings, characters)
- [x] Walk cycles, watering splash, harvest sparkle, patience ring, carried goods
- [x] Full MCP Apps lifecycle + defensive message filtering
- [x] `callServerTool` polling, movement interpolation, hidden-tab backoff
- [x] Light/dark via host context; safe-area insets; responsive to a narrow phone
- [x] Test asserting zero external URLs in the built HTML

**Acceptance:** met. Builds to one self-contained 59.6 kB HTML string; lifecycle
exercised in jsdom against a mocked host that injects the exact non-JSON-RPC
frames claude.ai is known to send.

## M5 — Wire together + deploy 🟡

- [x] UI-bearing tools return the resource (modern + legacy `_meta` keys)
- [x] Resource registered, listed and readable over the real transport
- [x] Text/structuredContent fallback verified for hosts that cannot render it
- [x] README documents setup, deploy and connecting to Claude
- [ ] **Deployed to Cloudflare** — blocked, see [Outstanding](#outstanding)

## M6 — Polish & balance ✅

- [x] Three scripted playthrough profiles, all viable, none dominant
- [x] Economy retuned (Wren's throughput was making expansion strictly worse)
- [x] Wren line pool — 44 lines across 13 contexts
- [x] 12 named customers with distinct portraits and buying personalities
- [x] Events ticker
- [x] Property tests over the sim's invariants
- [x] Compliance checklist below

---

## Outstanding

**Deployment.** `wrangler` requires an interactive browser login against a
Cloudflare account only the repo owner has. Everything up to that point is done
and verified: the production bundle builds (`wrangler deploy --dry-run`,
232 kB gzipped, DO binding resolved), and the entire request path is covered by
tests running in real `workerd`.

```bash
npx wrangler login
npm run deploy
curl https://<printed-url>/health     # expect {"ok": true, "service": "homestead"}
```

Then add `https://<printed-url>/mcp/<a-private-key>` to Claude as a custom
connector. Nothing else is outstanding.

---

## Compliance checklist

A line-by-line self-review against the build brief.

### §2 Architecture

| #   | Requirement                                                                                                    | Status                                                            |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | TypeScript end-to-end, Node 22+, strict, no Python                                                             | ✅ strict + `noUncheckedIndexedAccess`; zero Python               |
| 2   | Streamable HTTP MCP, deployable as a Claude custom connector; current spec + MCP Apps; docs read before coding | ✅ SDK 1.30.0 / ext-apps 1.7.5, APIs read from installed packages |
| 3   | Cloudflare Workers + Durable Objects; alarms drive the tick; offline caps                                      | ✅ no fallback needed                                             |
| 4   | Server-authoritative; UI is a view; polling via `callServerTool`                                               | ✅ the view never mutates anything                                |
| 5   | Single-player per session, multi-tenant, fresh farm on new connection, persisted indefinitely                  | ✅ keyed URL → DO id                                              |
| 6   | Written for an LLM: descriptive names, rich descriptions, summary + state in results                           | ✅ every result carries `{summary, events, state}`                |

### §3 Known claude.ai pitfalls

| Requirement                                                                                                                                                  | Status                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Fully self-contained UI HTML, zero external network dependencies                                                                                             | ✅ asserted by the build script _and_ two tests                          |
| Defensive postMessage — early-return on `jsonrpc !== "2.0"`, never throw                                                                                     | ✅ tested with auth frames, bare strings, `null`, arrays, wrong versions |
| Full lifecycle: `ui/initialize`, `initialized`, `tool-input`, `tool-result`, `resource-teardown`, `host-context-changed` (theme + safe-area, light and dark) | ✅ all tested                                                            |
| Plain-text fallback on every UI-bearing tool                                                                                                                 | ✅ tested explicitly                                                     |
| Iframe may be unmounted and recreated; all view state reconstructable from one `get_farm_state`                                                              | ✅ tested                                                                |

### §4 Game design

| Requirement                                                                                          | Status                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Fixed 16×12 grid, hand-authored, stored as editable data                                             | ✅ ASCII art in `data/map.ts`                          |
| 12 tillable plots in a 4×3 block                                                                     | ✅ verified by test                                    |
| Coop (6 chickens), barn (3 cows), well, barn storage, farm stand, farmhouse, paths                   | ✅                                                     |
| Tile types + walkability; Wren pathfinds on the grid                                                 | ✅ BFS; connectivity property-tested                   |
| 6 crops with the specified economics table                                                           | ✅ exact match                                         |
| Growth stages seed → sprout → growing → mature                                                       | ✅                                                     |
| Crop advances only if watered; unwatered stalls, never dies                                          | ✅                                                     |
| Plots tilled before planting; harvest returns plot to tilled                                         | ✅                                                     |
| Chickens 100g / 1 egg per ~40 min if fed; cows 400g / 1 milk per ~60 min                             | ✅                                                     |
| Feed costs money, bought in bulk from the shop                                                       | ✅ bulk discount                                       |
| Unfed → no production, mood happy → content → grumpy; grumpy sometimes skips                         | ✅                                                     |
| Feeding + `pet` restore mood; animals never die                                                      | ✅                                                     |
| Animals have cute default names; player can rename                                                   | ✅                                                     |
| Wren task queue, FIFO, reorderable                                                                   | ✅                                                     |
| Task types: till, plant, water, harvest, feed, collect, restock, pet, idle                           | ✅ all nine                                            |
| Walk time + work time; visibly at the location                                                       | ✅ walk direction, action icon, carried-item indicator |
| Stamina 0–100, drains, recovers idling at the farmhouse, refuses work when spent, in-fiction message | ✅                                                     |
| Wren personality, ~40 pre-written lines, no LLM calls from the server                                | ✅ 44 lines, deterministic draw                        |
| Gold starts 500; 4 radish seeds, 2 tomato seeds, 1 chicken, feed                                     | ✅                                                     |
| Customers on a Poisson-ish timer (~8 min), modulated by reputation                                   | ✅                                                     |
| Name, portrait variant, want list, price tolerance, ~10 min patience                                 | ✅                                                     |
| `list_waiting_customers` → `sell_to_customer` (accept or counter); greedy counters risk walking      | ✅                                                     |
| Sales raise reputation, walkouts lower it; reputation scales frequency and tolerance                 | ✅                                                     |
| Supply shop, fixed prices, no travel                                                                 | ✅                                                     |
| Reputation milestones; certificate at 90; no fail state                                              | ✅                                                     |
| 1 real second = 1 game-minute; 5 game-min per alarm; client-side interpolation                       | ✅                                                     |
| Offline: alarms up to 2 game-hours, then pause; fast-simulate remaining on return + summary          | ✅ single shared budget                                |

### §5 Tool surface

All ten tools implemented under their final names, with `{summary, events, state}`
in `structuredContent` and the UI resource on every mutating tool. ✅

### §6 The farm view

| Requirement                                                                                                     | Status                  |
| --------------------------------------------------------------------------------------------------------------- | ----------------------- |
| One UI resource, `ui://homestead/farm-view`                                                                     | ✅                      |
| `registerAppResource` / `registerAppTool` with `_meta.ui.resourceUri`                                           | ✅ modern + legacy keys |
| Inline SVG tile art: grass, tilled soil, crop stages per crop, coop, barn, well, stand, farmhouse, path, fences | ✅                      |
| Wren with 4-direction movement; chicken/cow with mood; customer sprites                                         | ✅                      |
| CSS animations: walk cycle, watering splash, ready sparkle, patience ring                                       | ✅                      |
| Render on `tool-result`, then poll every 2s; interpolate; back off when hidden                                  | ✅                      |
| Tooltips on plot / animal / customer; task-queue sidebar; event ticker                                          | ✅                      |
| Light/dark via host context; responsive down to ~360px                                                          | ✅                      |

### §7 Repository & quality bar

| Requirement                                                      | Status                      |
| ---------------------------------------------------------------- | --------------------------- |
| Directory layout as specified                                    | ✅                          |
| Strict TypeScript, ESLint, Prettier                              | ✅ all clean                |
| `sim/` deterministic given (state, seed, ticks); property-tested | ✅ dedicated property suite |
| Vitest; sim thoroughly tested; tool handlers integration-tested  | ✅ 322 tests                |
| Conventional commits at green checkpoints; never red at a commit | ✅                          |

### Deliberate deviations

Three, each argued in DECISIONS.md rather than done silently:

1. **Hand-rolled MCP Apps client** instead of the `App` class — the brief
   requires the UI to have zero runtime dependencies, and the SDK would pull in
   zod plus the Protocol machinery into a resource that must ship as one string.
2. **One growth number instead of per-stage water budgets** — the brief
   specifies both per-stage water gating and a total watering count, which
   double-specify the same thing. Watered-time accrual preserves every
   observable rule with one number.
3. **Selling requires stand stock** — the brief lists `restock` as a task but
   does not say sales depend on it. Made load-bearing so the task has a purpose,
   with the friction made legible everywhere rather than removed.
