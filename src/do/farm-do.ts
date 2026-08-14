/**
 * FarmDurableObject — one instance per farm.
 *
 * Owns the farm's persistent state and (from M3) the alarm loop that keeps the
 * world ticking between requests. MCP requests are handled here so that reads
 * and writes are serialized by the Durable Object's single-threaded execution.
 */

import { DurableObject } from "cloudflare:workers";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../server/mcp-server.ts";
import type { Env } from "../server/env.ts";

export class FarmDurableObject extends DurableObject<Env> {
  /**
   * Handles one MCP request end to end.
   *
   * Stateless transport: a fresh server and transport per request, torn down as
   * soon as the response has been buffered. `enableJsonResponse` means the body
   * is fully materialized when `handleRequest` resolves, so buffering it before
   * teardown is safe and lets us close cleanly rather than leaking a transport.
   */
  override async fetch(request: Request): Promise<Response> {
    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      return await bufferResponse(response);
    } finally {
      try {
        await transport.close();
        await server.close();
      } catch {
        // Teardown failures must never mask the real response.
      }
    }
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
