import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  currentStateDump,
  serializeCurrentStateDump,
} from "../src/ui/state-dump";
import type { GameState, Scenario } from "../src/types";

describe("current state dump", () => {
  it("copies only the fields needed to diagnose a live round", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: [],
      cast: { classRep: "person" },
      incidents: [],
      loops: 3,
      daysPerLoop: 4,
    };
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    state.loop.loop = 2;
    state.loop.day = 3;
    state.loop.phase = "P6_GOODWILL";
    state.loop.leader = 1;
    state.loop.spentOncePerLoop.protagonists[1].push("goodwillPlus2");
    state.loop.abilitiesUsedThisLoop.push("classRep:goodwill:0");
    state.loop.abilitiesUsedThisRound.push("classRep:goodwill:0");
    state.loop.charCounters.classRep.goodwill = 2;

    const dump = currentStateDump(state);

    expect(Object.keys(dump)).toEqual([
      "loop",
      "day",
      "phase",
      "leader",
      "spentOncePerLoop",
      "abilitiesUsedThisLoop",
      "abilitiesUsedThisRound",
      "board",
      "counters",
    ]);
    expect(dump).toMatchObject({
      loop: 2,
      day: 3,
      phase: "P6_GOODWILL",
      leader: 1,
      spentOncePerLoop: {
        mastermind: [],
        protagonists: [[], ["goodwillPlus2"], []],
      },
      abilitiesUsedThisLoop: ["classRep:goodwill:0"],
      abilitiesUsedThisRound: ["classRep:goodwill:0"],
      counters: { classRep: { goodwill: 2 } },
    });
    expect(JSON.parse(serializeCurrentStateDump(state))).toEqual(dump);

    dump.counters.classRep.goodwill = 99;
    expect(state.loop.charCounters.classRep.goodwill).toBe(2);
  });
});
