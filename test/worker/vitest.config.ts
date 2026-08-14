import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Runs these tests inside real workerd, with the Durable Object binding wired
 * up exactly as it is in production.
 *
 * Note: @cloudflare/vitest-pool-workers 0.21 replaced the old
 * `defineWorkersProject` (from the removed "./config" subpath) with a Vite
 * plugin. See DECISIONS.md.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "../../wrangler.jsonc" },
    }),
  ],
  test: {
    name: "worker",
    include: ["**/*.test.ts"],
  },
});
