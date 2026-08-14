/**
 * Worker entry point.
 *
 * Routes:
 *   ALL  /mcp            -> the shared "demo" farm
 *   ALL  /mcp/<farm-key> -> a private farm, keyed by URL (see DECISIONS.md)
 *   GET  /health         -> liveness probe
 *   GET  /               -> a human-readable landing page with setup steps
 *
 * All MCP traffic is forwarded to the farm's Durable Object, which serializes
 * access and owns the simulation.
 */

import { devHostPage } from "./dev-host.ts";
import { normalizeFarmKey, type Env } from "./env.ts";
import { landingPage } from "./landing.ts";

export { FarmDurableObject } from "../do/farm-do.ts";

const MCP_PATH = /^\/mcp(?:\/([^/]*))?\/?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "homestead" });
    }

    const match = MCP_PATH.exec(url.pathname);
    if (match) {
      if (request.method === "OPTIONS") return corsPreflight();
      const farmKey = normalizeFarmKey(match[1]);
      const id = env.FARM.idFromName(farmKey);
      const stub = env.FARM.get(id);
      const response = await stub.fetch(request);
      return withCors(response);
    }

    // Local dev host: lets the farm view run in a plain browser, outside Claude.
    if (url.pathname === "/dev" || url.pathname === "/dev/") {
      const farmKey = normalizeFarmKey(url.searchParams.get("farm"));
      return new Response(devHostPage(farmKey), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(landingPage(url.origin), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return json({ error: "not_found", hint: "MCP endpoint is at /mcp" }, 404);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, accept",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
