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

| Package                            | Version          | Why                                                                                                             |
| ---------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk`        | `1.30.0`         | Current stable. Ships `WebStandardStreamableHTTPServerTransport` (see below), which is what makes Workers viable. |
| `@modelcontextprotocol/ext-apps`   | `1.7.5`          | Current stable MCP Apps SDK. Implements spec `2026-01-26`.                                                       |
| `zod`                              | `^3.25.76`       | Peer of the MCP SDK's tool-schema layer. Only used server-side.                                                  |
| `typescript`                       | `5.9.3` (exact)  | TS `7.0.2` (the Go port) is out but the lint/type ecosystem is still stabilising on it. Deliberately conservative. |
| `vitest`                           | `^4.1.10`        | Required by `@cloudflare/vitest-pool-workers@0.21.3` (peer: `^4.1.0`).                                           |
| `@cloudflare/vitest-pool-workers`  | `^0.21.3`        | Runs tests inside real workerd — needed to test Durable Objects + alarms for M3.                                 |
| `wrangler`                         | `^4.123.0`       | Current. Peer-requires `@cloudflare/workers-types@^5`.                                                           |
| `@cloudflare/workers-types`        | `^5.20260814.1`  | v4 conflicts with wrangler 4.123's peer range; v5 is required.                                                   |

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
`ui/initialize` has resolved *and* `ui/notifications/initialized` has been sent.
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

Instead: a crop needs `growMinutes` of *watered* time. One watering tops moisture
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
