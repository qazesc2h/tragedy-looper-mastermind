import { describe, expect, it } from "vitest";

import { publicBoardChanges } from "../src/engine/public-observation";
import { initLoop } from "../src/engine/setup";
import { adjustSpecialGauge } from "../src/engine/special-gauge";
import type { Scenario } from "../src/types";

function scenario(tragedySet: string): Scenario {
  return {
    tragedySet,
    mainPlot: "",
    subPlots: [],
    cast: { scientist: "person" },
    incidents: [],
    loops: 3,
    daysPerLoop: 3,
  };
}

describe("special gauge foundation", () => {
  it("creates gauges only for MC, CM, and HS", () => {
    expect(initLoop(scenario("midnightZone")).specialGauge).toBeUndefined();
    for (const tragedySet of [
      "mysteryCircle",
      "cosmicMythology",
      "hauntedStage",
    ]) {
      expect(initLoop(scenario(tragedySet)).specialGauge).toEqual({
        value: 0,
        increasedThisLoop: false,
      });
    }
  });

  it("resets MC each loop and carries CM and HS across loops", () => {
    for (const tragedySet of [
      "mysteryCircle",
      "cosmicMythology",
      "hauntedStage",
    ]) {
      const first = initLoop(scenario(tragedySet));
      if (first.specialGauge === undefined) throw new Error("missing gauge");
      adjustSpecialGauge(first.specialGauge, 1);
      const second = initLoop(scenario(tragedySet), 2, first);
      expect(second.specialGauge).toEqual({
        value: tragedySet === "mysteryCircle" ? 0 : 1,
        increasedThisLoop: false,
      });
    }
  });

  it("records a real increase and exposes the public change", () => {
    const before = initLoop(scenario("cosmicMythology"));
    const after = structuredClone(before);
    if (after.specialGauge === undefined) throw new Error("missing gauge");
    adjustSpecialGauge(after.specialGauge, 1);

    expect(after.specialGauge.increasedThisLoop).toBe(true);
    expect(publicBoardChanges(before, after)).toContainEqual({
      kind: "specialGauge",
      delta: 1,
    });
    expect(() => adjustSpecialGauge(
      { value: 0, increasedThisLoop: false },
      -1,
    )).toThrow("cannot be negative");
  });
});
