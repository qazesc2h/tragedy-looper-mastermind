import { describe, expect, it } from "vitest";

import {
  CHARACTER_COUNTERS,
  INCIDENT_SELECTABLE_COUNTERS,
  TRANSFERABLE_CHARACTER_COUNTERS,
  emptyCharacterCounters,
} from "../src/counters";
import { resolveIncidentEffect } from "../src/engine/incident";
import { initLoop } from "../src/engine/setup";
import type { GameState, Scenario } from "../src/types";

const scenario: Scenario = {
  tragedySet: "basicTragedy",
  mainPlot: "murderPlan",
  subPlots: [],
  cast: { girlStudent: "person", boyStudent: "person" },
  incidents: [],
  loops: 3,
  daysPerLoop: 3,
};

describe("character counter registry", () => {
  it("defines protection as transferable but not incident-selectable", () => {
    expect(CHARACTER_COUNTERS).toEqual([
      "goodwill",
      "paranoia",
      "intrigue",
      "protection",
    ]);
    expect(INCIDENT_SELECTABLE_COUNTERS).toEqual([
      "goodwill",
      "paranoia",
      "intrigue",
    ]);
    expect(TRANSFERABLE_CHARACTER_COUNTERS).toEqual(CHARACTER_COUNTERS);
    expect(emptyCharacterCounters()).toEqual({
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    });
  });

  it("rejects protection for Butterfly Effect even from an untyped input", () => {
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    expect(() => resolveIncidentEffect(
      state,
      "butterflyEffect",
      "girlStudent",
      { target: "boyStudent", counter: "protection" as never },
    )).toThrow("counter type is not eligible");
  });
});
