import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "sim",
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/worker/**"],
  },
});
