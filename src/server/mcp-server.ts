/**
 * Builds the MCP server for one request.
 *
 * The Streamable HTTP transport runs in stateless mode (see DECISIONS.md), so a
 * fresh McpServer is constructed per request. All durable state lives in the
 * Durable Object; this module is pure wiring.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { almanacText, buildAlmanac } from "../tools/almanac.ts";
import { SERVER_INSTRUCTIONS } from "./instructions.ts";

export const SERVER_INFO = {
  name: "homestead",
  version: "0.1.0",
} as const;

export function createMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
    capabilities: {
      tools: {},
      resources: {},
    },
  });

  registerAlmanacTool(server);

  // Farm tools (get_farm_state, assign_tasks, commerce, meta) are registered in
  // M2 once the simulation and persistence layers exist.

  return server;
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
