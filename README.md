# 🌾 Homestead

A cozy farming game you play entirely by talking to Claude.

There is no app to click. You connect Homestead to Claude as a custom connector,
say _"show me my farm"_, and from then on you run the place by conversation:

> **You:** Till three beds and put tomatoes in, then feed the chickens.
> **Claude:** _(calls `assign_tasks`)_ Wren's on it — she's heading out to plot 1
> now. The farm view below updates as she works.

On the farm lives **Wren**, your farmhand, and she runs the place herself:
harvesting, watering, feeding the animals and carrying goods out to the stand
without being asked. You're the owner, not the labourer — you decide what to
grow, what to charge, and what to invest in. You can still direct her whenever
you like; anything you assign takes priority over her own plans.

Customers arrive at the stand with a private idea of what they'll pay and buy on
their own if your price is right. Crops grow, animals get hungry, and the world
keeps ticking between your messages.

Every meaningful tool call renders a **live top-down view of the farm** inline in
the conversation — Wren walking to a plot, watering it, carrying crates to the
stand, customers waiting with their patience ticking down.

---

## Requirements

- **Node 22+**
- A **Cloudflare account** (the free plan is enough)
- The **Wrangler** CLI, installed with the project's dependencies

## Quick start

```bash
npm install
npm test          # builds the farm view, then runs the whole suite
npm run dev       # local server at http://localhost:8787
```

`npm run dev` serves the MCP endpoint at `http://localhost:8787/mcp/<your-key>`.

To see the farm view on its own, without any of the MCP plumbing:

```bash
npm run build:fixture
open dist/farm-view-fixture.html
```

That renders a farm produced by actually running the simulation, so it shows real
crop stages, real animal moods and real customers.

## Deploying

### By hand

```bash
npx wrangler login     # opens a browser to authorise your Cloudflare account
npm run deploy         # builds the UI and deploys the Worker
```

Wrangler prints the deployed URL, e.g. `https://homestead.<subdomain>.workers.dev`.

### From GitHub Actions

`.github/workflows/deploy.yml` runs the full suite on every push and pull
request, and deploys to Cloudflare when `main` goes green. It needs two repository
secrets — **Settings → Secrets and variables → Actions**:

| Secret                  | Where to get it                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare dashboard → My Profile → API Tokens → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → **Account ID** in the sidebar                |

The token needs `Account → Workers Scripts → Edit`. Because this Worker uses
SQLite-backed Durable Objects, it also needs `Account → Durable Objects → Edit` —
the stock **Edit Cloudflare Workers** template already covers both.

After deploying, the workflow polls `/health` and fails the run if the Worker does
not answer, so a green check means it is genuinely serving. If your Worker is on a
custom domain, set a `WORKER_URL` repository **variable** and the smoke test will
probe that instead of the `workers.dev` URL.

Two things to know:

- The **Durable Object migration** in `wrangler.jsonc` is applied automatically on
  first deploy. It uses SQLite-backed Durable Objects, which are available on the
  free plan.
- Everything except the deploy itself — the whole game, the tools and the UI — is
  verified by `npm test`, which runs the real Worker inside `workerd`.

Check it is alive:

```bash
curl https://<your-worker-url>/health
# {"ok": true, "service": "homestead"}
```

## Connecting it to Claude

1. Open Claude → **Settings** → **Connectors** → **Add custom connector**.
2. Paste your server URL with a **private farm key** on the end:

   ```
   https://homestead.<subdomain>.workers.dev/mcp/my-secret-farm-key
   ```

3. Save, then start a conversation and say **"show me my farm"**.

### About that farm key

Your farm lives at whatever key is in the URL, and it persists forever. Pick
something unguessable — it is the only thing protecting your farm, and **anyone
who has the URL can play it**. The key is required: `/mcp` on its own returns
`404 farm_key_required` rather than serving a farm.

Each distinct key is its own farm, with its own storage, created on first
contact. That is how several people share one deployment without sharing a save.

This is a deliberate v1 tradeoff (see `DECISIONS.md`); a production-grade version
would use OAuth instead. If a key ever leaks, `new_farm` gives you a clean slate,
or just switch to a new key.

## How to play

Talk to Claude. It has the tools; you have the ideas. Things worth trying:

- _"What's the most profitable thing I can grow right now?"_
- _"Till plots 1 through 4, plant strawberries, and water them."_
- _"Who's at the stand? Can we fill their order?"_
- _"Offer Marta 120 for the lot."_
- _"Buy a cow. Name her Custard."_
- _"What happened while I was gone?"_

A few rules the game will hold you to:

| Rule                                     | Why it bites                                                      |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Plots must be **tilled** before planting | Queue the till first — `assign_tasks` will tell you if you forgot |
| Crops grow only while **watered**        | A dry plot stalls. It never dies, it just waits                   |
| Customers buy from the **farm stand**    | Harvests land in the barn, so queue a `restock` task              |
| Wren has **stamina**                     | Work her flat and she'll rest before taking more on               |
| Animals produce only while **fed**       | And an unfed animal gets grumpy, and a grumpy one skips           |

`get_almanac` has the full economics — Claude will read it rather than guess.

## The tools

| Tool                     | What it does                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| `get_farm_state`         | The whole farm: plots, crops, animals, Wren, inventory, customers  |
| `get_almanac`            | Static reference: crop economics, animal costs, shop prices, rules |
| `assign_tasks`           | Queue work for Wren, in order, validated as a batch                |
| `clear_task_queue`       | Drop everything pending                                            |
| `reorder_task_queue`     | Promote a task to the front                                        |
| `buy_supplies`           | Seeds, feed and livestock, delivered instantly                     |
| `list_waiting_customers` | Who's waiting, what they want, whether you can serve them          |
| `sell_to_customer`       | Accept an offer, or counter it                                     |
| `rename`                 | Rename Wren or any animal                                          |
| `new_farm`               | Start over (requires `confirm: true`)                              |

Every tool that changes anything returns `{summary, events, state}` plus the farm
view. `events` is what happened since your last call, which is how Claude can
narrate the time you didn't see.

## Architecture

```
src/
  sim/      Pure simulation engine — no I/O, deterministic, heavily tested
  tools/    MCP tool definitions and handlers, over a FarmStore seam
  do/       Durable Object: persistence and the alarm loop
  server/   Worker entry, routing, MCP wiring
  ui/       Farm view source; built into ONE self-contained HTML string
  data/     Crops, animals, customers, shop, map, Wren's lines
```

The pieces that matter:

- **The simulation is pure and deterministic.** Given the same state, seed and
  tick count it produces the same farm, every time. No wall-clock reads, no
  `Math.random()`. That is what makes it testable, replayable, and safe to
  fast-forward after an absence.
- **The server is authoritative.** The farm view is a _view_; it never mutates
  anything, and it can rebuild itself completely from one `get_farm_state` call,
  because the host may unmount and recreate the iframe at any moment.
- **One Durable Object per farm.** It owns the state and runs an alarm loop so
  the world advances between requests. Its single-threaded execution serializes
  ticks against reads and writes for free.
- **The farm view has zero dependencies and zero external references.** No CDN,
  no web fonts, no remote images — all inlined, and the build fails if anything
  external creeps in. Claude.ai enforces a strict CSP on the app iframe, so this
  is a correctness requirement, not a preference.

## Time

One real second is one game-minute. A radish is ready about twenty seconds after
it's planted and watered — fast feedback matters more than realism here, because
you're having a conversation, not waiting on a crop.

When you go quiet, the world keeps running for up to **two game-hours** and then
pauses. Come back and you'll get a _"while you were away"_ summary. A farm left
alone overnight is greeted with a good morning, not a week of missed customers.

## Development

```bash
npm test           # everything (builds the UI first)
npm run test:watch # watch mode
npm run typecheck  # strict TypeScript
npm run lint       # ESLint
npm run format     # Prettier
npm run cf-types   # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

Tests run as two projects:

- **`sim`** — the simulation, the tool handlers (driven over a real in-memory
  JSON-RPC transport), and the farm view (in jsdom, against a mocked MCP Apps
  host).
- **`worker`** — the real Worker and Durable Object inside `workerd`, covering
  persistence, eviction, alarms and the MCP transport itself.

After changing anything in `src/ui/`, run `npm run build:ui` (or just `npm test`,
which does it for you).

See `DECISIONS.md` for why things are the way they are, and `PROGRESS.md` for the
milestone checklist.
