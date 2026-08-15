/**
 * Worker entry point.
 *
 * Routes:
 *   ALL  /mcp            -> 404; a farm key is required (see DECISIONS.md)
 *   ALL  /mcp/<farm-key> -> a private farm, keyed by URL
 *   GET  /health         -> liveness probe
 *   GET  /               -> a human-readable landing page with setup steps
 *
 * All MCP traffic is forwarded to the farm's Durable Object, which serializes
 * access and owns the simulation.
 */

import { devHostPage } from "./dev-host.ts";
import { DEFAULT_FARM_KEY, normalizeFarmKey, type Env } from "./env.ts";
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
      const farmKey = normalizeFarmKey(decodeSegment(match[1]));
      if (farmKey === null) {
        return withCors(
          json(
            {
              error: "farm_key_required",
              hint: "Your farm lives at /mcp/<your-private-farm-key>. Pick something unguessable — anyone with the URL can play that farm.",
            },
            404,
          ),
        );
      }
      const id = env.FARM.idFromName(farmKey);
      const stub = env.FARM.get(id);
      const response = await stub.fetch(request);
      return withCors(response);
    }

    // Local dev host: lets the farm view run in a plain browser, outside Claude.
    // It addresses the farm by an explicit key, so falling back here is a local
    // convenience and never exposes a keyless farm over /mcp.
    if (url.pathname === "/dev" || url.pathname === "/dev/") {
      const farmKey = normalizeFarmKey(url.searchParams.get("farm")) ?? DEFAULT_FARM_KEY;
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

/**
 * Percent-decodes the farm key from the path.
 *
 * `pathname` keeps its escapes, so without this a key of `%20` would have its
 * `%` stripped by normalization and quietly become the farm `20` — a real farm,
 * on a URL that carried no real key. Malformed escapes decode to nothing rather
 * than throwing, which normalization then refuses.
 */
function decodeSegment(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

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
