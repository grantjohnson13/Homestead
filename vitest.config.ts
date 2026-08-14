import { defineConfig } from "vitest/config";

/**
 * Two projects:
 *  - "sim"    : pure Node tests for the simulation, data and tool handlers.
 *  - "worker" : runs inside real workerd via @cloudflare/vitest-pool-workers, so
 *               Durable Objects, storage and alarms are the genuine article.
 */
export default defineConfig({
  test: {
    projects: ["./vitest.sim.config.ts", "./test/worker/vitest.config.ts"],
  },
});
