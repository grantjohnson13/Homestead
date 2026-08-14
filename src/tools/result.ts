/**
 * The shape every mutating tool returns.
 *
 * The brief's contract: `{summary, events, state}` in structuredContent, plus a
 * text rendering that stands on its own if the host cannot show the UI. Claude
 * should be able to narrate a turn from one result without a follow-up call.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { eventsSince, type FarmState } from "../sim/index.ts";
import { describeFarm, snapshot, type FarmSnapshot } from "./snapshot.ts";

/** Most events a single tool result will narrate. */
const MAX_REPORTED_EVENTS = 25;

export interface ToolPayload extends Record<string, unknown> {
  summary: string;
  events: string[];
  state: FarmSnapshot;
}

export interface BuildResultOptions {
  /** One-line description of what this call did. */
  summary: string;
  /** Index into state.events from before the call; everything after is new. */
  eventCursor: number;
  /** Extra structured fields specific to this tool. */
  extra?: Record<string, unknown>;
  /** A line of Wren's, appended to the prose. */
  wrenLine?: string;
  /** Set when a catch-up simulation produced a welcome-back digest. */
  awaySummary?: string | null;
}

export function buildResult(state: FarmState, options: BuildResultOptions): CallToolResult {
  const snap = snapshot(state);
  // Cap the narration: after a long absence the log can be dense, and Claude
  // needs the recent, actionable end of it rather than all sixty lines.
  const since = eventsSince(state, options.eventCursor);
  const events = since.slice(-MAX_REPORTED_EVENTS).map((event) => event.text);
  const omitted = Math.max(0, since.length - events.length);

  const payload: ToolPayload = {
    summary: options.summary,
    events,
    state: snap,
    ...(options.extra ?? {}),
  };

  const sections: string[] = [];
  if (options.awaySummary) sections.push(options.awaySummary);
  sections.push(options.summary);
  if (events.length > 0) {
    const heading =
      omitted > 0
        ? `Since your last look (${omitted} earlier lines omitted):`
        : "Since your last look:";
    sections.push(`${heading}\n${events.map((e) => `- ${e}`).join("\n")}`);
  }
  sections.push(describeFarm(snap));
  if (options.wrenLine) sections.push(`${state.wren.name}: ${options.wrenLine}`);

  return {
    content: [{ type: "text", text: sections.join("\n\n") }],
    structuredContent: payload,
  };
}

/** A failure that is the player's to fix, not a server fault. */
export function refusal(message: string, extra?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { summary: message, events: [], ...(extra ?? {}) },
    isError: true,
  };
}

/**
 * The events consumed from a catch-up are already reflected in the digest, so
 * tools clear the flag once they have reported it.
 */
export function takeAwaySummary(state: FarmState): string | null {
  const summary = state.awaySummary;
  state.awaySummary = null;
  return summary;
}
