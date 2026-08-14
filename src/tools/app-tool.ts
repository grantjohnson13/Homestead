/**
 * Registering tools that carry the farm view.
 *
 * `registerAppTool` normalises the UI metadata for us — it writes both the
 * modern `_meta.ui.resourceUri` and the legacy `_meta["ui/resourceUri"]`, so
 * older hosts still find the resource. This wrapper just supplies the URI and
 * forwards the SDK's generics, so tool handlers keep their inferred argument
 * types.
 */

import type {
  McpServer,
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";

/** The one UI resource every farm tool points at. */
export const FARM_VIEW_URI = "ui://homestead/farm-view";

export const FARM_VIEW_META = { ui: { resourceUri: FARM_VIEW_URI } } as const;

export interface FarmToolConfig<InputArgs> {
  title?: string;
  description: string;
  inputSchema?: InputArgs;
  annotations?: ToolAnnotations;
}

/**
 * Registers a tool whose result should render the farm.
 *
 * Every UI-bearing tool still returns full text and structuredContent, so the
 * game stays completely playable on hosts that do not render the iframe.
 */
export function registerFarmViewTool<InputArgs extends ZodRawShapeCompat>(
  server: McpServer,
  name: string,
  config: FarmToolConfig<InputArgs>,
  cb: ToolCallback<InputArgs>,
): RegisteredTool {
  // The public signature above is the precise one; these casts only bridge to
  // registerAppTool's own generic plumbing, which infers InputArgs from an
  // optional field and so cannot line up with an already-bound type parameter.
  return registerAppTool(server, name, { ...config, _meta: FARM_VIEW_META } as never, cb as never);
}
