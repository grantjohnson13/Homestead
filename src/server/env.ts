import type { FarmDurableObject } from "../do/farm-do.ts";

export interface Env {
  FARM: DurableObjectNamespace<FarmDurableObject>;
}

/** Farm key used when the connector URL carries no key of its own. */
export const DEFAULT_FARM_KEY = "demo";

/**
 * Farm keys come from the connector URL, so keep them tame: they end up in a
 * Durable Object name and in log lines.
 */
export function normalizeFarmKey(raw: string | undefined | null): string {
  if (!raw) return DEFAULT_FARM_KEY;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : DEFAULT_FARM_KEY;
}
