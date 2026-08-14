/**
 * Drives the real MCP server over an in-memory transport pair, so tool tests go
 * through genuine JSON-RPC: real schema validation, real result envelopes, real
 * error handling. The only thing faked is the wall clock, so a test can make
 * game time pass on demand.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../../src/server/mcp-server.ts";
import { REAL_MS_PER_TICK } from "../../src/sim/constants.ts";
import type { FarmState } from "../../src/sim/index.ts";
import { MemoryFarmStore } from "../../src/tools/store.ts";
import type { FarmSnapshot } from "../../src/tools/snapshot.ts";

export interface ToolResponse {
  raw: CallToolResult;
  text: string;
  isError: boolean;
  data: Record<string, unknown>;
  state: FarmSnapshot;
  events: string[];
  summary: string;
}

export class GameHarness {
  readonly store: MemoryFarmStore;
  private client!: Client;

  constructor(startMs = 1_000_000) {
    this.store = new MemoryFarmStore(startMs);
  }

  async connect(): Promise<void> {
    const server = createMcpServer(this.store);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    this.client = new Client({ name: "homestead-test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), this.client.connect(clientTransport)]);
  }

  async listTools(): Promise<{ name: string; description?: string }[]> {
    const result = await this.client.listTools();
    return result.tools;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> {
    const raw = (await this.client.callTool({ name, arguments: args })) as CallToolResult;
    const data = (raw.structuredContent ?? {}) as Record<string, unknown>;
    const text = (raw.content ?? [])
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return {
      raw,
      text,
      isError: raw.isError === true,
      data,
      state: data["state"] as FarmSnapshot,
      events: (data["events"] as string[]) ?? [],
      summary: (data["summary"] as string) ?? "",
    };
  }

  /** Lets `minutes` of game time pass, the way a pause in conversation would. */
  passTime(minutes: number): void {
    this.store.advanceRealMs(minutes * REAL_MS_PER_TICK);
  }

  /** Peeks at the stored farm. Tests assert through tools where they can. */
  async peek(): Promise<FarmState> {
    const state = await this.store.read();
    if (!state) throw new Error("no farm yet");
    return state;
  }

  /** Edits the stored farm directly, to set up a scenario cheaply. */
  async poke(mutate: (state: FarmState) => void): Promise<void> {
    const state = await this.peek();
    mutate(state);
    await this.store.write(state);
  }
}

export async function newGame(startMs = 1_000_000): Promise<GameHarness> {
  const harness = new GameHarness(startMs);
  await harness.connect();
  return harness;
}
