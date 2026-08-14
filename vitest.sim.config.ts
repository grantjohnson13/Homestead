import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "sim",
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/worker/**"],
    // The farm view is exercised in a real DOM against a mocked MCP Apps host.
    environmentMatchGlobs: [["test/ui/**", "jsdom"]],
  },
});
