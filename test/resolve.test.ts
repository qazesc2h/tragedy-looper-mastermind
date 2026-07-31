import { describe, it } from "vitest";

import { loadManualExamples } from "./helpers";

const manualExamples = loadManualExamples();

describe("manual resolution examples", () => {
  for (const testCase of manualExamples.cases) {
    it.todo(testCase.id);
  }
});
