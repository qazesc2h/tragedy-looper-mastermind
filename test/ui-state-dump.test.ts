import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  currentStateDump,
  phaseProgressionDiagnostics,
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
      "scenario",
      "gamePhase",
      "loop",
      "day",
      "phase",
      "leader",
      "placed",
      "spentOncePerLoop",
      "abilitiesUsedThisLoop",
      "abilitiesUsedThisRound",
      "board",
      "counters",
      "locationIntrigue",
      "pendingLoopEnd",
      "pendingImmediateLossKeys",
      "phaseProgression",
      "errors",
    ]);
    expect(dump).toMatchObject({
      loop: 2,
      gamePhase: "ROUND",
      scenario: {
        tragedySet: "basicTragedy",
        mainPlot: "murderPlan",
        cast: { classRep: "person" },
      },
      day: 3,
      phase: "P6_GOODWILL",
      leader: 1,
      placed: [],
      spentOncePerLoop: {
        mastermind: [],
        protagonists: [[], ["goodwillPlus2"], []],
      },
      abilitiesUsedThisLoop: ["classRep:goodwill:0"],
      abilitiesUsedThisRound: ["classRep:goodwill:0"],
      counters: { classRep: { goodwill: 2 } },
      locationIntrigue: { Hospital: 1 },
      pendingLoopEnd: null,
      pendingImmediateLossKeys: [],
      phaseProgression: expect.arrayContaining([{
        phase: "P6_GOODWILL",
        status: "ready",
        canProgress: true,
        reasons: [],
      }]),
      errors: [{
        action: "phase-advance",
        message: "test failure",
      }],
    });
    expect(JSON.parse(serializeCurrentStateDump(state))).toEqual(dump);

    dump.counters.classRep.goodwill = 99;
    expect(state.loop.charCounters.classRep.goodwill).toBe(2);
  });

  it("shows why a corrupted P4 cannot progress", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: [],
      cast: { classRep: "person" },
      incidents: [],
      loops: 1,
      daysPerLoop: 1,
    };
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    state.loop.phase = "P4_RESOLVE";
    state.loop.placed.push({
      owner: "mastermind",
      card: "intriguePlus1",
      target: { kind: "character", id: "classRep" },
    });

    expect(phaseProgressionDiagnostics(state)).toContainEqual({
      phase: "P4_RESOLVE",
      status: "blocked",
      canProgress: false,
      reasons: ["배치 카드 6장 필요 (현재 1장)"],
    });
    expect(currentStateDump(state).placed).toEqual(state.loop.placed);

    state.scenario.cast.servant = "person";
    state.scenario.cast.richStudent = "person";
    state.loop.board.servant = { status: "alive", at: "School" };
    state.loop.board.richStudent = { status: "alive", at: "School" };
    state.loop.charCounters.servant = {
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    };
    state.loop.charCounters.richStudent = {
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    };
    state.loop.placed = [
      {
        owner: "mastermind",
        card: "moveHorizontal",
        target: { kind: "character", id: "richStudent" },
      },
      {
        owner: "mastermind",
        card: "moveVertical",
        target: { kind: "location", at: "Hospital" },
      },
      {
        owner: "mastermind",
        card: "paranoiaPlus1",
        target: { kind: "location", at: "City" },
      },
      {
        owner: 0,
        card: "moveVertical",
        target: { kind: "location", at: "Hospital" },
      },
      {
        owner: 1,
        card: "moveHorizontal",
        target: { kind: "location", at: "Shrine" },
      },
      {
        owner: 2,
        card: "paranoiaPlus1",
        target: { kind: "location", at: "City" },
      },
    ];
    expect(phaseProgressionDiagnostics(state)).toContainEqual({
      phase: "P4_RESOLVE",
      status: "blocked",
      canProgress: false,
      reasons: ["메이드 동행 여부 선택 필요"],
    });
  });
});
