# PROGRESS

Living milestone checklist. Read before each work session; update after each
meaningful step.

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

**Acceptance:** `npm test` green (16 tests), transcript below.

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
        "name": "get_almanac",
        "title": "Read the farm almanac",
        "description": "Static reference data for the whole game: crop economics ...",
        "inputSchema": { "$schema": "http://json-schema.org/draft-07/schema#", "type": "object", "properties": {} },
        "annotations": { "readOnlyHint": true, "openWorldHint": false },
        "execution": { "taskSupport": "forbidden" }
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 2
}
```

The full, unabridged transcript is kept as a checked-in snapshot at
`test/worker/__snapshots__/handshake.txt` and re-verified on every test run, so
it cannot silently drift.

> Note on tooling: `curl` is not available in this build environment, so the
> transcript is produced by an integration test that drives the identical
> Worker -> Durable Object -> transport path inside real `workerd` via
> `@cloudflare/vitest-pool-workers`. This is strictly stronger than a curl
> transcript: it runs in CI on every commit.

---

## M1 — Simulation core

- [ ] Deterministic RNG + tick loop
- [ ] Plots: till / plant / water / growth stages / stalling / harvest / regrow
- [ ] Wren: task queue, pathfinding, work phases, stamina
- [ ] Animals: feeding, mood, production
- [ ] Customers: spawning, wants, patience, timeout
- [ ] Economy: gold, inventory, stand stock, reputation
- [ ] >=40 unit tests covering every rule in the design spec
- [ ] 200-tick "demo day" trajectory test

## M2 — MCP tools

- [ ] `get_farm_state`, `get_almanac`
- [ ] `assign_tasks`, `clear_task_queue`, `reorder_task_queue`
- [ ] `buy_supplies`, `list_waiting_customers`, `sell_to_customer`, `rename`
- [ ] `new_farm`
- [ ] Full scripted playthrough integration test via tool calls only

## M3 — Durable Object + alarms

- [ ] Farm state persisted in DO storage
- [ ] Alarm loop advances the world between requests
- [ ] Offline cap (2 game-hours) + "while you were away" summary
- [ ] Persistence + alarm tests in workerd

## M4 — Farm view UI

- [ ] Inline SVG tile art + sprites
- [ ] Walk cycles, watering splash, harvest sparkle, patience ring
- [ ] Full MCP Apps lifecycle + defensive message filtering
- [ ] `callServerTool` polling with interpolation and hidden-tab backoff
- [ ] Light/dark via host context; responsive to 360px
- [ ] Test asserting zero external URLs in the built HTML

## M5 — Wire together + deploy

- [ ] UI-bearing tools return the resource
- [ ] Deployed to Cloudflare
- [ ] README connect-to-claude.ai instructions
- [ ] End-to-end verification against the deployed URL

## M6 — Polish & balance

- [ ] Three playthrough profiles viable (cautious / aggressive / animal-focused)
- [ ] Wren line pool (~40 lines)
- [ ] >=10 named customers
- [ ] Events ticker
- [ ] Compliance checklist against the full brief
