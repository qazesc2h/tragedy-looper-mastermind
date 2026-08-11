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
    state.loop.locIntrigue.Hospital = 1;
    state.runtimeErrors = [{
      occurredAt: "2026-08-11T00:00:00.000Z",
      action: "phase-advance",
      message: "test failure",
      gamePhase: state.gamePhase,
      loop: structuredClone(state.loop),
    }];

    const dump = currentStateDump(state);

    expect(Object.keys(dump)).toEqual([
      "gamePhase",
      "loop",
      "day",
      "phase",
      "leader",
      "spentOncePerLoop",
      "abilitiesUsedThisLoop",
      "abilitiesUsedThisRound",
      "board",
      "counters",
      "locationIntrigue",
      "pendingImmediateLossKeys",
      "errors",
    ]);
    expect(dump).toMatchObject({
      loop: 2,
      gamePhase: "ROUND",
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
      locationIntrigue: { Hospital: 1 },
      pendingImmediateLossKeys: [],
      errors: [{
        action: "phase-advance",
        message: "test failure",
      }],
    });
    expect(JSON.parse(serializeCurrentStateDump(state))).toEqual(dump);

    dump.counters.classRep.goodwill = 99;
    expect(state.loop.charCounters.classRep.goodwill).toBe(2);
  });
});
