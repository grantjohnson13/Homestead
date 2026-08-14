/**
 * Builds the MCP server for one request.
 *
 * The Streamable HTTP transport runs in stateless mode (see DECISIONS.md), so a
 * fresh McpServer is constructed per request. All durable state lives in the
 * Durable Object; this module is pure wiring.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { almanacText, buildAlmanac } from "../tools/almanac.ts";
import { registerFarmTools } from "../tools/farm-tools.ts";
import { FARM_VIEW_URI } from "../tools/app-tool.ts";
import type { FarmStore } from "../tools/store.ts";
import { FARM_VIEW_HTML } from "../ui/generated/farm-view.html.ts";
import { SERVER_INSTRUCTIONS } from "./instructions.ts";

export const SERVER_INFO = {
  name: "homestead",
  version: "0.1.0",
} as const;

export function createMcpServer(store: FarmStore): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
    capabilities: {
      tools: {},
      resources: {},
    },
  });

  registerFarmView(server);
  registerAlmanacTool(server);
  registerFarmTools(server, store);

  return server;
}

/**
 * The single UI resource shared by every farm tool.
 *
 * No `_meta.ui.csp` is declared: the resource has zero external references by
 * construction (asserted at build time), and claude.ai does not reliably honour
 * declared domains anyway. Self-containment is the only thing that travels.
 */
function registerFarmView(server: McpServer): void {
  registerAppResource(
    server,
    "Farm view",
    FARM_VIEW_URI,
    {
      description:
        "A live top-down view of the farm: crops growing in their plots, Wren walking her task " +
        "queue, animals in the coop and barn, and customers waiting at the stand.",
    },
    async () => ({
      contents: [
        {
          uri: FARM_VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: FARM_VIEW_HTML,
        },
      ],
    }),
  );
}

function registerAlmanacTool(server: McpServer): void {
  server.registerTool(
    "get_almanac",
    {
      title: "Read the farm almanac",
      description:
        "Static reference data for the whole game: crop economics (seed cost, grow time, " +
        "watering needs, sell price, yield, and computed gold-per-minute), animal costs and " +
        "production rates, supply shop prices, and plain-language explanations of every " +
        "mechanic (growth and watering, stamina, selling from the stand, negotiation, " +
        "reputation). Nothing here changes during play. Call this once when the player asks " +
        'what to plant, whether an animal is worth buying, or "why isn\'t this growing?" — ' +
        "it saves guessing at numbers.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const payload = buildAlmanac();
      return {
        content: [{ type: "text", text: almanacText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}
