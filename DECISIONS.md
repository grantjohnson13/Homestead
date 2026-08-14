# DECISIONS

Every non-obvious choice, dated, with reasoning. Newest sections appended as the
build progresses.

---

## 2026-08-14 — M0: Research findings & pinned versions

### Research method

Rather than trusting web docs (which lag), the authoritative API surface was read
directly out of `node_modules` after installing the packages: the `.d.ts` files
and the compiled `dist/src/app.js` of `@modelcontextprotocol/ext-apps`. Where the
build prompt and the shipped SDK disagreed, **the SDK source won** (per §10 of the
brief).

### Pinned versions

| Package                           | Version         | Why                                                                                                                |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@modelcontextprotocol/sdk`       | `1.30.0`        | Current stable. Ships `WebStandardStreamableHTTPServerTransport` (see below), which is what makes Workers viable.  |
| `@modelcontextprotocol/ext-apps`  | `1.7.5`         | Current stable MCP Apps SDK. Implements spec `2026-01-26`.                                                         |
| `zod`                             | `^3.25.76`      | Peer of the MCP SDK's tool-schema layer. Only used server-side.                                                    |
| `typescript`                      | `5.9.3` (exact) | TS `7.0.2` (the Go port) is out but the lint/type ecosystem is still stabilising on it. Deliberately conservative. |
| `vitest`                          | `^4.1.10`       | Required by `@cloudflare/vitest-pool-workers@0.21.3` (peer: `^4.1.0`).                                             |
| `@cloudflare/vitest-pool-workers` | `^0.21.3`       | Runs tests inside real workerd — needed to test Durable Objects + alarms for M3.                                   |
| `wrangler`                        | `^4.123.0`      | Current. Peer-requires `@cloudflare/workers-types@^5`.                                                             |
| `@cloudflare/workers-types`       | `^5.20260814.1` | v4 conflicts with wrangler 4.123's peer range; v5 is required.                                                     |

### MCP Apps protocol — verified facts

Protocol version constant shipped in ext-apps 1.7.5: **`2026-01-26`**.

Wire methods (extracted from the dist bundle):

```
ui/initialize                            (app -> host, request)
ui/notifications/initialized             (app -> host, notification)
ui/notifications/tool-input              (host -> app)
ui/notifications/tool-input-partial      (host -> app)
ui/notifications/tool-result             (host -> app)
ui/notifications/tool-cancelled          (host -> app)
ui/notifications/host-context-changed    (host -> app)
ui/resource-teardown                     (host -> app, request; app replies {})
ui/notifications/size-changed            (app -> host)
ui/notifications/request-teardown        (app -> host)
ui/message, ui/open-link, ui/download-file, ui/request-display-mode,
ui/update-model-context
```

`ui/initialize` params: `{ appInfo, appCapabilities, protocolVersion }`.
Its result: `{ protocolVersion, hostInfo, hostCapabilities, hostContext }`.

`callServerTool(...)` is **not** a bespoke `ui/*` method — it is a plain MCP
`tools/call` request sent over the postMessage transport, which the host proxies
to the server. Same for `resources/read` and `resources/list`.

### Confirmed pitfall #1 — defensive postMessage filtering is real

The SDK's own `PostMessageTransport` does exactly what the brief warned about:

```js
const parsed = JSONRPCMessageSchema.safeParse(event.data);
if (parsed.success) this.onmessage?.(parsed.data);
else if (event.data?.jsonrpc !== "2.0") /* silently ignore */;
else this.onerror?.(...)
```

So: **any message whose `data.jsonrpc !== "2.0"` must be silently ignored, never
thrown on.** Our hand-rolled client replicates this precisely.

Framing: messages are posted **raw** (no envelope) via
`window.parent.postMessage(msg, "*")`, and received via a `window` `message`
listener filtered on `event.source === window.parent`.

### Confirmed pitfall #2 — never call host methods before the handshake completes

ext-apps 1.7.5 added an `_assertInitialized` guard whose doc comment cites two
open Claude.ai bugs (`anthropics/claude-ai-mcp#61`, `#149`): calling a host-bound
method (e.g. `callServerTool`) before `ui/initialize` has resolved "can race the
handshake on strict hosts and **leave the iframe permanently hidden**."

Consequence for us: the farm view must not poll, resize, or call any tool until
`ui/initialize` has resolved _and_ `ui/notifications/initialized` has been sent.
Polling is armed only from the post-handshake callback. Likewise, one-shot
notification handlers (`tool-result`, `tool-input`) must be registered **before**
connecting, or the host may have already fired them.

### Decision — hand-rolled UI client instead of the `App` class

`@modelcontextprotocol/ext-apps`'s `App` class pulls in zod v4 plus the MCP SDK's
`Protocol` machinery. Bundling that into the iframe HTML would add hundreds of KB
to a resource that must ship as one self-contained string, and zod's JIT parser
needs `unsafe-eval` (the SDK works around it with `z.config({ jitless: true })`).

The brief requires the UI to have **zero runtime dependencies**. Since the wire
protocol is a handful of JSON-RPC messages (verified above), the farm view
implements the client side by hand in ~150 lines: no dependencies, no eval, a
small bundle, and exact control over the defensive filtering. Fidelity to the
real protocol is protected by unit tests against a mocked postMessage host.

### Decision — Cloudflare Workers is viable; no fallback needed

The brief allowed a Fly.io/Node fallback if Workers proved incompatible. It is
not needed:

- `@modelcontextprotocol/sdk@1.30.0` ships
  `server/webStandardStreamableHttp.js` exporting
  `WebStandardStreamableHTTPServerTransport`, built on `Request`/`Response`/
  `ReadableStream`, whose own docblock gives a Cloudflare Workers usage example.
- Grepping the modules on our critical path (`webStandardStreamableHttp`, `mcp`,
  `server/index`, `shared/protocol`, `types`) turns up **zero** `node:` imports.

We run it in **stateless mode** (`sessionIdGenerator: undefined`,
`enableJsonResponse: true`): a fresh `McpServer` + transport is constructed per
request inside the Durable Object, with all durable state in DO storage. This
suits Workers' request-scoped model and sidesteps SSE lifetime limits.

### Decision — farm identity via keyed URL

Farms must persist **indefinitely**, but MCP sessions are ephemeral (a new
session per reconnect), so a session ID cannot own a farm. Options considered:

1. Stateful `Mcp-Session-Id` → farm resets on every reconnect. Rejected.
2. OAuth → correct long-term, but heavy for v1 and the brief permits shipping
   unauthenticated/keyed.
3. **Keyed URL** (chosen): the connector URL carries the farm key,
   `https://<host>/mcp/<farm-key>`. The Durable Object ID is derived from that
   key, so the farm is stable forever and is private as long as the URL is.

Tradeoff, stated plainly: the key is a bearer secret in a URL. Anyone with the
URL owns that farm, and it may leak via logs or shoulder-surfing. Acceptable for
a single-player cozy farming game with no real-world stakes; a real product would
use OAuth. `/mcp` with no key maps to a shared `demo` farm for quick trials, and
the README says so. `new_farm` gives an escape hatch if a key is compromised.

### Host theming tokens

The host supplies CSS custom properties through `hostContext.styles` — the full
set was extracted from the bundle (`--color-{background,text,border,ring}-*`,
`--font-*`). The farm view consumes these with its own pastel fallbacks, so it
looks native in both Claude light and dark themes and still renders standalone in
a plain browser (where the host vars are absent).

---

## 2026-08-14 — M0: findings while wiring it up

### Two different protocol version lines

The `initialize` handshake negotiates the **core MCP** version, which
`@modelcontextprotocol/sdk@1.30.0` reports as `2025-11-25`. The **MCP Apps**
`ui/*` sub-protocol carries its own version, `2026-01-26`, exchanged separately
during `ui/initialize` between host and iframe. These are independent; seeing
`2025-11-25` in the handshake is correct and not a downgrade.

### `@cloudflare/vitest-pool-workers` 0.21 changed its config API

The widely-documented `defineWorkersProject` from
`@cloudflare/vitest-pool-workers/config` no longer exists — the `./config`
subpath export was removed. 0.21 exposes `cloudflareTest(options)` from the
package root, which returns a **Vite plugin** used inside a normal
`defineConfig`. The `isolatedStorage` pool option is gone too. The package ships
a `vitest-v3-to-v4` codemod, confirming this is the intended migration.

### `curl` is unavailable in this build environment

M0 and M5 both call for curl transcripts. `curl` cannot be executed here, so
verification is done with an integration test driving the same
Worker -> Durable Object -> transport path inside real `workerd`
(`@cloudflare/vitest-pool-workers`). The exact wire bytes are captured as a
checked-in file snapshot (`test/worker/__snapshots__/handshake.txt`) re-verified
on every run — a strictly stronger check than a one-off curl invocation, since it
runs in CI.

### Transport teardown on Workers

In stateless mode with `enableJsonResponse: true`, `handleRequest` resolves with a
fully-materialized body. The Durable Object therefore buffers the response into a
detached `Response` before closing the transport and server, so nothing leaks per
request and no body is ever truncated by teardown.

### Stateless mode does not require `initialize` first

Verified by test: a `tools/list` POST against a fresh stateless transport is
answered without a preceding `initialize` on that transport. This matters because
every request constructs a new server, so there is no cross-request session to
initialize.

### Growth model — chosen interpretation

The brief says a crop "only advances to the next stage if its water requirement
for the current stage was met" and separately gives each crop a total watering
count. Modelling per-stage water budgets with four named stages and a separate
total would double-specify the same thing.

Instead: a crop needs `growMinutes` of _watered_ time. One watering tops moisture
up to a single segment (`growMinutes / waterNeeds`), capped, so it cannot be
front-loaded by watering five times in a row. Growth accrues only while moisture
lasts; when it runs dry, growth stalls until someone waters again. The four
visual stages (seed / sprout / growing / mature) are derived from progress. This
preserves every observable rule in the brief — stalling, meaningful watering
counts, no crop death — with one number instead of two.

### Selling requires stand stock

The brief lists "restock farm stand" as a Wren task but does not say sales
require it. Making the stand purely decorative would leave that task type
pointless, so sales draw from **stand stock**, and harvests land in **barn
storage**.

The obvious risk is a player who has tomatoes but "can't sell them". Mitigated by
making it legible rather than by removing it: `get_almanac` explains it,
`list_waiting_customers` reports per-customer whether the stand can currently
fill the order, and `sell_to_customer`'s error names the exact restock task to
queue. One extra task per batch is management, not busywork.

---

## 2026-08-14 — M5: wiring and deployment

### No `_meta.ui.csp` is declared

`registerAppResource` supports declaring `csp.resourceDomains` /
`csp.connectDomains`. We declare neither, because the farm view has no external
references at all — a property asserted by the build script _and_ by two separate
tests. Declaring a CSP we do not need would only create the impression that
external loads are supported, which on claude.ai they are not reliably.

### Deployment could not be completed from this environment

`wrangler whoami` reports no authentication, and `wrangler login` is an
interactive browser OAuth flow against an account only the repo owner has. This
is precisely the "deployment credentials you cannot have" blocker the brief
anticipates.

Considered and rejected: `wrangler deploy --temporary`, which deploys to an
ephemeral Cloudflare preview account without logging in. It would have produced a
live URL, but one the owner cannot manage, keep, or point a connector at
long-term — and it would publish a public endpoint on an account that is not
theirs. Verifying against a throwaway URL is worth less than leaving a clean
one-command handoff.

What _was_ verified instead, and is arguably stronger than a curl against a
deployed URL:

- `wrangler deploy --dry-run` builds the real production bundle (1260 KiB raw,
  232 KiB gzipped — comfortably inside limits) with the Durable Object binding
  resolved.
- The `worker` test project runs the actual Worker and Durable Object inside
  `workerd`, the same runtime Cloudflare executes in production, and exercises
  the MCP handshake, `tools/list`, `tools/call`, `resources/list`,
  `resources/read`, persistence across eviction, and the alarm loop.

**TODO for the human — the entire remaining deployment step:**

```bash
npx wrangler login
npm run deploy
curl https://<printed-url>/health     # expect {"ok": true, "service": "homestead"}
```

Then add `https://<printed-url>/mcp/<a-private-key>` to Claude as a custom
connector. Nothing else is outstanding.

---

## 2026-08-14 — M6: balance

Method: `scripts/balance-report.ts` runs three scripted players across five seeds
at four horizons and prints the spread. The assertions in
`test/sim/balance.test.ts` lock in the band that pass produced.

### Wren was the bottleneck, and it made expansion strictly worse

The first balance run was damning: the "aggressive expander" finished _behind_
the cautious player at every horizon, and both trailed a farm that simply did
less. The cause was Wren's throughput, not the crop economics.

Original numbers: 3-tick tasks, 1.6 stamina drained per work tick, and a
four-charge watering can. A single pass over a modest field cost more than her
entire stamina bar, so she was permanently exhausted, and the four-charge can
sent her back to the well constantly — walking swallowed the day.

Changed:

|                      | Before                       | After                        |
| -------------------- | ---------------------------- | ---------------------------- |
| `workDrainPerTick`   | 1.6                          | 0.9                          |
| `walkDrainPerTick`   | 0.4                          | 0.25                         |
| `restRecoverPerTick` | 2.2                          | 3.0                          |
| task work ticks      | till 3 / water 2 / harvest 3 | till 2 / water 1 / harvest 2 |
| `WATER_CAN_CAPACITY` | 4                            | 8                            |

Stamina should be a reason to pace yourself, not a wall. Walking still dominates
the cost of a job, which keeps _where you send her_ the interesting decision.

### One farmhand cannot sustain twelve plots, and that is correct

Even after the retune, keeping all twelve plots watered needs roughly twice
Wren's sustainable output — every plot wants water every 20–30 game-minutes, and
a full pass costs more than that. Rather than inflate her throughput until the
constraint vanished, this was kept: the field is deliberately larger than one
person can farm, and choosing how much to take on _is_ the management game.
Around six to eight plots is the practical ceiling, which the scripted expander
now targets.

### The most expensive crop is a trap, deliberately

A pumpkin sells for 220g — by far the highest sticker price — but ties up a plot
for 150 watered minutes, making it worse per minute than a tomato that bears
twice. The first version of the scripted expander picked crops by sell price and
went broke doing it.

This is kept as a feature, and `test/sim/balance.test.ts` asserts it stays true.
It gives `get_almanac` a real job: the almanac computes gold-per-minute, so a
player who asks Claude what to plant beats a player who buys the shiniest seed.
The scripted expander was changed to model an informed player, since that is who
the game is actually for.

### Where the balance landed (600 game-minutes, mean of five seeds)

| player         | gold | Δ    | rep | sales |
| -------------- | ---- | ---- | --- | ----- |
| cautious       | 737  | +237 | 66  | 11    |
| aggressive     | 799  | +299 | 54  | 11    |
| animal-focused | 727  | +227 | 96  | 27    |

All three profitable, inside a factor of two of each other, none explosive, and
each with a distinct shape: the expander invests through a long dry start and
overtakes late; the animal farm compounds reputation fastest; the cautious farm
is never in danger. That is the spread the milestone asked for.

### Playtesting found what the balance tests could not

Two problems surfaced the moment a human played the game in a browser, neither
of which any automated test could have caught.

**Customer patience was unplayable.** The brief specifies ~10 game-minutes of
patience and arrivals every ~8, which at one real second per game-minute means a
customer appears and leaves within **ten real seconds**. A player cannot read the
message, decide a price, and possibly send Wren to restock in that window, so
every customer timed out at −2 reputation and the game was quietly unwinnable.

The balance tests missed it completely because the scripted players served
customers programmatically in the same tick they arrived — patience never bit.
The lesson generalises: any quantity measured against _human_ response time
cannot be validated by a simulation that responds instantly.

Patience is now 150 game-minutes (~2.5 real minutes: a conversational turn plus
a barn-to-stand restock trip) and arrivals are spaced to ~50 game-minutes, so
roughly one new customer appears per turn instead of four. `test/sim/clock.test.ts`
asserts these in _real seconds_ so the constraint is explicit rather than
incidental.

Fewer visitors meant thinner income, so basket sizes grew to match — a rarer
customer buys a proper basket. Quantities are still clamped to what the farm can
supply, so early baskets stay small and grow as the barn fills.

Result: timeouts went from 5–10 per run to **zero**, reputation now climbs
(76/61/93 at 600 minutes instead of 66/54/96 with constant attrition), and all
three strategies remain profitable inside a factor of 1.2.

**The clock read as a broken stopwatch.** The header showed raw elapsed time
(`4h 37m`) climbing every second. The pace is deliberate and stayed unchanged;
only the presentation moved to a farm day-clock (`Day 2 · 07:15`), computed
server-side in `sim/clock.ts` so the UI and the text fallback cannot disagree.
Farms start at 6am.

### Selling became a price list, not a negotiation

The brief's selling flow — `list_waiting_customers` then `sell_to_customer` to
accept or counter — assumes a player who is watching the counter. Playtesting
showed that assumption does not survive contact with a conversational client.

The failure was stark. A customer arrived wanting two radishes, two radishes were
sitting on the stand, and they walked anyway, because the model was mid-sentence
composing a reply. The event log caught it to the second:

```
1678  Sold 3 tomatoes and 2 eggs to Della for 138g (+4 rep)
1679  Rooke waited as long as they could and left unserved (-2 rep)
1680  Sold 2 radishes to Wilhelmina for 56g (+4 rep)
```

Raising patience only moves the problem: the world runs continuously while the
player acts in discrete turns, so _any_ per-customer decision will sometimes
expire unmade.

So selling is now a **standing decision** instead of a reaction. You set a price
per good with `set_prices`; each customer arrives with a private ceiling for
their basket and buys on their own the moment your price is at or under it and
the stand can fill the order. Nobody needs to be at the counter, and a good price
list keeps earning between conversations.

What this buys, beyond fixing the bug:

- **Pricing is a real strategy.** Charge a premium and watch people walk; undercut
  and move volume. Reputation raises the whole valley's ceiling, so it now has a
  direct economic meaning rather than just changing arrival rate.
- **The market is learnable.** Every price walkout is recorded with what that
  customer _would_ have paid, and `pricingInsights` turns the log into a
  suggested price. You find the ceiling by bumping into it.
- **Failure modes are distinguishable.** Losing someone to an empty shelf (−2 rep)
  is a different mistake from losing them to a high price (−1 rep), and the game
  says which happened.

`sell_to_customer` survives as a manual override for one-off deals below the list
price. Willingness-to-pay is anchored to the _reference_ price, never to your own
asking price — otherwise raising prices would raise what people pay and the lever
would do nothing.

### Customer throughput, not production, is the binding constraint

Making the stand self-serving exposed the real shape of the economy. With
arrivals spaced for human response time, only about a dozen customers visit in a
long session, and each buys a handful of items. A farm therefore cannot sell its
way out of trouble on volume — roughly three dozen units is all the market will
absorb, however much the barn holds.

Two consequences, both now baked in:

- The animal strategy was quietly unprofitable because a 100g hen laying 20g eggs
  needs five sales to repay herself, and there simply are not enough buyers.
  Animal goods are priced against livestock cost rather than against vegetables
  (egg 20 → 28, milk 45 → 62).
- There has to be genuine headroom above the reference price or the pricing lever
  is decorative, so willingness-to-pay widened to 0.9× at reputation 0 and 1.7× at 100.

Post-change balance at 600 game-minutes: cautious +220, aggressive +206,
animal-focused +63. All profitable, inside a factor of 1.3, each pricing to its
own strategy.

### The brief's 30-game-minute horizon is too short to measure

Thirty game-minutes is barely one radish cycle plus walking, and no strategy has
sold anything by then. The three profiles are therefore asserted at 30 minutes
only for what is observable there — nobody goes into debt, nobody loses
reputation, Wren is still standing — and the economic claims are asserted at 600
minutes where they can actually be seen.
