import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/phase5-feasibility-gates.test.ts",
      "test/phase5-feasibility-benchmark.test.ts",
    ],
  },
});
