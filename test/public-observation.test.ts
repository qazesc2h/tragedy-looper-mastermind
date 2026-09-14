import { describe, expect, it } from "vitest";

import { publicBoardChanges } from "../src/engine/public-observation";
import { initLoop } from "../src/engine/setup";
import type { Scenario } from "../src/types";

const scenario: Scenario = {
  tragedySet: "basicTragedy",
  mainPlot: "murderPlan",
  subPlots: [],
  cast: { girlStudent: "person" },
  incidents: [],
  loops: 3,
  daysPerLoop: 7,
};

describe("public board changes", () => {
  it("stores only the location ID on a status change", () => {
    const before = initLoop(scenario);
    before.board.girlStudent = { status: "alive", at: "Shrine" };
    const after = structuredClone(before);
    after.board.girlStudent = { status: "dead", at: "Shrine" };

    expect(publicBoardChanges(before, after)).toEqual([{
      kind: "status",
      character: "girlStudent",
      from: "alive",
      to: "dead",
      at: "Shrine",
    }]);
  });
});
