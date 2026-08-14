/**
 * FarmDurableObject — one instance per farm.
 *
 * Owns the farm's persistent state and the alarm loop that keeps the world
 * ticking between requests, so crops finish and customers come and go while the
 * player is mid-conversation. MCP requests are handled here too, which means the
 * Durable Object's single-threaded execution serializes ticks against reads and
 * writes for free.
 */

import { DurableObject } from "cloudflare:workers";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../server/mcp-server.ts";
import type { Env } from "../server/env.ts";
import { REAL_MS_PER_TICK, TICKS_PER_ALARM } from "../sim/constants.ts";
import { catchUp, msUntilNextTick, remainingAwayBudget, type FarmState } from "../sim/index.ts";
import type { FarmStore } from "../tools/store.ts";

const FARM_KEY = "farm";

/** How far ahead the next tick alarm is scheduled. */
export const ALARM_INTERVAL_MS = TICKS_PER_ALARM * REAL_MS_PER_TICK;

/** Backs the tool layer with this Durable Object's own storage. */
class DurableFarmStore implements FarmStore {
  constructor(private readonly ctx: DurableObjectState) {}

  now(): number {
    return Date.now();
  }

  async read(): Promise<FarmState | null> {
    return (await this.ctx.storage.get<FarmState>(FARM_KEY)) ?? null;
  }

  async write(state: FarmState): Promise<void> {
    await this.ctx.storage.put(FARM_KEY, state);
  }
}

export class FarmDurableObject extends DurableObject<Env> {
  private readonly store: FarmStore = new DurableFarmStore(this.ctx);

  /**
   * Handles one MCP request end to end.
   *
   * Stateless transport: a fresh server and transport per request, torn down as
   * soon as the response has been buffered. `enableJsonResponse` means the body
   * is fully materialized when `handleRequest` resolves, so buffering it before
   * teardown is safe and lets us close cleanly rather than leaking a transport.
   */
  override async fetch(request: Request): Promise<Response> {
    const server = createMcpServer(this.store);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      const buffered = await bufferResponse(response);
      // The player is active, so restart the clock for the next stretch.
      await this.scheduleTick();
      return buffered;
    } finally {
      try {
        await transport.close();
        await server.close();
      } catch {
        // Teardown failures must never mask the real response.
      }
    }
  }

  /**
   * Advances the world, then decides whether to keep going.
   *
   * The loop stops once the away budget is spent, so an abandoned farm costs
   * nothing to host and the player is not greeted by a week of missed customers.
   */
  override async alarm(): Promise<void> {
    const state = await this.store.read();
    if (!state) return;

    catchUp(state, Date.now());
    await this.store.write(state);

    if (remainingAwayBudget(state) > 0) {
      await this.scheduleTick(state);
    }
  }

  /**
   * Arms the next tick, unless one is already pending.
   *
   * The interval shortens as the farm's speed rises, so a fast world still
   * animates smoothly instead of jumping in large strides between alarms.
   */
  private async scheduleTick(state?: FarmState | null): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null) return;

    const farm = state ?? (await this.store.read());
    const delay = farm ? msUntilNextTick(farm, TICKS_PER_ALARM) : ALARM_INTERVAL_MS;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  /* ---------------------------------------------------- test/ops surface -- */

  /** Reads the raw farm state. Used by tests and diagnostics. */
  async debugState(): Promise<FarmState | null> {
    return this.store.read();
  }

  /** Writes raw farm state, so tests can stage a scenario. */
  async debugWrite(state: FarmState): Promise<void> {
    await this.store.write(state);
  }

  /** Whether a tick is currently armed. */
  async debugAlarmAt(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }
}

/**
 * Reads a Response fully into memory and returns an equivalent detached one, so
 * the underlying transport can be closed without truncating the body.
 */
async function bufferResponse(response: Response): Promise<Response> {
  if (!response.body) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
