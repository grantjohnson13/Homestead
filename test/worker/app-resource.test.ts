import { describe, expect, it } from "vitest";
import { rpc } from "./mcp-client.ts";

/**
 * M5's acceptance path: an MCP client must be able to list the tools, see the
 * UI metadata, list resources, and read the farm view itself — all over the real
 * transport, exactly as claude.ai's connector would.
 */

const PATH = "/mcp/ui-test";
const FARM_VIEW_URI = "ui://homestead/farm-view";

interface ToolEntry {
  name: string;
  _meta?: Record<string, unknown>;
}

async function listTools(): Promise<ToolEntry[]> {
  const result = await rpc(PATH, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  return result["tools"] as ToolEntry[];
}

describe("the farm view resource", () => {
  it("is advertised in resources/list", async () => {
    const result = await rpc(PATH, { jsonrpc: "2.0", id: 2, method: "resources/list", params: {} });
    const resources = result["resources"] as { uri: string; mimeType?: string }[];

    const view = resources.find((r) => r.uri === FARM_VIEW_URI);
    expect(view).toBeDefined();
    expect(view?.mimeType).toBe("text/html;profile=mcp-app");
  });

  it("can be read, and comes back as a complete HTML document", async () => {
    const result = await rpc(PATH, {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: FARM_VIEW_URI },
    });

    const contents = result["contents"] as { uri: string; mimeType: string; text: string }[];
    expect(contents).toHaveLength(1);

    const html = contents[0]?.text ?? "";
    expect(contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html.length).toBeGreaterThan(20_000);
  });

  it("is served with no external references", async () => {
    const result = await rpc(PATH, {
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: FARM_VIEW_URI },
    });
    const html = (result["contents"] as { text: string }[])[0]?.text ?? "";

    const urls = [...html.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)]
      .map((m) => m[0])
      .filter((url) => !url.includes("w3.org"));

    expect(urls).toEqual([]);
  });

  it("points every farm tool at that one resource", async () => {
    const tools = await listTools();
    const uiTools = [
      "get_farm_state",
      "assign_tasks",
      "clear_task_queue",
      "reorder_task_queue",
      "buy_supplies",
      "list_waiting_customers",
      "sell_to_customer",
      "rename",
      "new_farm",
    ];

    for (const name of uiTools) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const ui = tool?._meta?.["ui"] as { resourceUri?: string } | undefined;
      expect(ui?.resourceUri, name).toBe(FARM_VIEW_URI);
    }
  });

  it("also writes the legacy metadata key for older hosts", async () => {
    const tools = await listTools();
    const tool = tools.find((t) => t.name === "get_farm_state");
    expect(tool?._meta?.["ui/resourceUri"]).toBe(FARM_VIEW_URI);
  });

  it("leaves the almanac as a plain tool, since it has nothing to draw", async () => {
    const tools = await listTools();
    const almanac = tools.find((t) => t.name === "get_almanac");
    expect(almanac).toBeDefined();
    expect(almanac?._meta?.["ui"]).toBeUndefined();
  });

  it("still returns a usable text fallback alongside the UI", async () => {
    const result = await rpc(PATH, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "get_farm_state", arguments: {} },
    });

    const content = result["content"] as { type: string; text: string }[];
    expect(content[0]?.type).toBe("text");
    // A host that cannot render the iframe still gets the whole game state.
    expect(content[0]?.text).toContain("Field:");
    expect(content[0]?.text).toContain("reputation");

    const structured = result["structuredContent"] as Record<string, unknown>;
    expect(structured).toHaveProperty("summary");
    expect(structured).toHaveProperty("events");
    expect(structured).toHaveProperty("state");
  });

  it("reports an unknown resource rather than crashing", async () => {
    await expect(
      rpc(PATH, {
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: { uri: "ui://homestead/nope" },
      }),
    ).rejects.toThrow();
  });
});
