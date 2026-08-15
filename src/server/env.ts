import type { FarmDurableObject } from "../do/farm-do.ts";

export interface Env {
  FARM: DurableObjectNamespace<FarmDurableObject>;
}

/** Farm key the local dev host falls back to. Never used to serve `/mcp`. */
export const DEFAULT_FARM_KEY = "demo";

/**
 * Farm keys come from the connector URL, so keep them tame: they end up in a
 * Durable Object name and in log lines.
 *
 * Returns `null` when the URL carries nothing usable. The key is the only thing
 * standing between a stranger and someone's farm, so a missing one is refused
 * rather than quietly defaulted — `/mcp` used to land on a shared farm anyone
 * could edit, which is a poor default for a public deployment.
 */
export function normalizeFarmKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
}
