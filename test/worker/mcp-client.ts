/**
 * A tiny MCP-over-HTTP client for tests: does what curl would do, but inside
 * workerd so it exercises the real Worker -> Durable Object -> transport path.
 */

import { SELF } from "cloudflare:test";

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

export interface RawExchange {
  request: unknown;
  status: number;
  contentType: string;
  body: string;
  parsed: JsonRpcResponse | null;
}

const ACCEPT = "application/json, text/event-stream";

/** Posts a JSON-RPC message and returns both the parsed result and the raw wire text. */
export async function rpcRaw(
  path: string,
  message: Record<string, unknown>,
): Promise<RawExchange> {
  const response = await SELF.fetch(`https://homestead.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: ACCEPT,
    },
    body: JSON.stringify(message),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  return {
    request: message,
    status: response.status,
    contentType,
    body,
    parsed: parseBody(contentType, body),
  };
}

/** Posts a JSON-RPC request and returns its result, throwing on protocol errors. */
export async function rpc(
  path: string,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const exchange = await rpcRaw(path, message);
  if (!exchange.parsed) {
    throw new Error(
      `No JSON-RPC response (status ${exchange.status}, type ${exchange.contentType}): ${exchange.body.slice(0, 400)}`,
    );
  }
  if (exchange.parsed.error) {
    throw new Error(
      `JSON-RPC error ${exchange.parsed.error.code}: ${exchange.parsed.error.message}`,
    );
  }
  return exchange.parsed.result ?? {};
}

/** Sends a notification (no id, so no response body is expected). */
export async function notify(path: string, message: Record<string, unknown>): Promise<number> {
  const response = await SELF.fetch(`https://homestead.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT },
    body: JSON.stringify(message),
  });
  await response.text();
  return response.status;
}

/**
 * The transport may answer with plain JSON or with a single SSE frame depending
 * on negotiation, so accept both.
 */
function parseBody(contentType: string, body: string): JsonRpcResponse | null {
  if (!body.trim()) return null;
  if (contentType.includes("text/event-stream")) {
    for (const line of body.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload) return JSON.parse(payload) as JsonRpcResponse;
      }
    }
    return null;
  }
  try {
    return JSON.parse(body) as JsonRpcResponse;
  } catch {
    return null;
  }
}

export const INIT_MESSAGE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2026-01-26",
    capabilities: {},
    clientInfo: { name: "homestead-test-client", version: "1.0.0" },
  },
} as const;
