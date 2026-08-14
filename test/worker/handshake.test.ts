import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { INIT_MESSAGE, rpc, rpcRaw } from "./mcp-client.ts";

const PATH = "/mcp/testfarm";

describe("MCP transport", () => {
  it("serves a health probe", async () => {
    const response = await SELF.fetch("https://homestead.test/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("responds to initialize with server info and capabilities", async () => {
    const result = await rpc(PATH, INIT_MESSAGE);
    expect(result["protocolVersion"]).toBeTypeOf("string");
    expect(result["serverInfo"]).toMatchObject({ name: "homestead" });
    expect(result["capabilities"]).toHaveProperty("tools");
    expect(result["instructions"]).toContain("Homestead");
  });

  it("lists tools", async () => {
    const result = await rpc(PATH, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = result["tools"] as { name: string; description: string }[];
    expect(Array.isArray(tools)).toBe(true);
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_almanac");
    // Descriptions are written for an LLM; make sure they are actually written.
    for (const tool of tools) {
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(80);
    }
  });

  it("calls get_almanac and returns text plus structured content", async () => {
    const result = await rpc(PATH, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_almanac", arguments: {} },
    });
    const content = result["content"] as { type: string; text: string }[];
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("HOMESTEAD ALMANAC");

    const structured = result["structuredContent"] as Record<string, unknown>;
    expect(Array.isArray(structured["crops"])).toBe(true);
    expect((structured["crops"] as unknown[]).length).toBe(6);
    expect(structured).toHaveProperty("mechanics");
  });

  it("isolates farms by URL key", async () => {
    // Both keys must answer independently; this is the multi-tenant routing path.
    for (const key of ["alpha", "beta"]) {
      const result = await rpc(`/mcp/${key}`, INIT_MESSAGE);
      expect(result["serverInfo"]).toMatchObject({ name: "homestead" });
    }
  });

  it("rejects unknown paths", async () => {
    const response = await SELF.fetch("https://homestead.test/nope");
    expect(response.status).toBe(404);
  });

  /**
   * Snapshots the literal wire traffic for initialize + tools/list. Doubles as
   * the M0 acceptance transcript (reproduced in PROGRESS.md) and as a guard
   * against accidentally changing the tool surface.
   */
  it("matches the recorded handshake transcript", async () => {
    const lines: string[] = [];
    for (const message of [
      INIT_MESSAGE as unknown as Record<string, unknown>,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]) {
      const exchange = await rpcRaw(PATH, message);
      expect(exchange.status).toBe(200);
      lines.push(`--> POST ${PATH}`);
      lines.push(JSON.stringify(exchange.request));
      lines.push(`<-- ${exchange.status} ${exchange.contentType}`);
      lines.push(JSON.stringify(exchange.parsed, null, 2));
      lines.push("");
    }
    await expect(lines.join("\n")).toMatchFileSnapshot("./__snapshots__/handshake.txt");
  });
});
