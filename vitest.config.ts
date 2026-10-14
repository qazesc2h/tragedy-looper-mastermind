import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "test/phase5-feasibility-benchmark.test.ts",
    ],
  },
});
