import { describe, expect, it } from "vitest";

import { killCharacter } from "../src/engine/death";
import {
  chooseInitialLeader,
  continueAfterLoopJudgment,
  continueFromTimeGap,
  createGameState,
  settleGameFlow,
} from "../src/engine/game";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import { collectProtagonistObservations } from "../src/engine/hypothesis";
import { publicBoardChanges } from "../src/engine/public-observation";
import { initLoop } from "../src/engine/setup";
import { adjustSpecialGauge } from "../src/engine/special-gauge";
import { renderScenarioEditor } from "../src/ui/scenario-editor";
import type { GameState, RoleId, Scenario } from "../src/types";

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

function goodwillState(
  tragedySet: string,
  cast: Record<string, RoleId>,
  loopNumber = 1,
): GameState {
  const configured: Scenario = {
    tragedySet,
    mainPlot: "",
    subPlots: [],
    cast,
    incidents: [],
    loops: 3,
    daysPerLoop: 3,
  };
  const loop = initLoop(configured, loopNumber);
  loop.phase = "P6_GOODWILL";
  return {
    scenario: configured,
    gamePhase: "ROUND",
    loop,
    history: [],
    loopOutcomes: [],
  };
}

describe("special gauge foundation", () => {
  it("creates gauges only for MC, CM, and HS", () => {
    for (const tragedySet of ["basicTragedy", "midnightZone"]) {
      expect(initLoop(scenario(tragedySet)).specialGauge).toBeUndefined();
    }
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
      beforeValue: 0,
      afterValue: 1,
      delta: 1,
    });
    expect(() => adjustSpecialGauge(
      { value: 0, increasedThisLoop: false },
      -1,
    )).toThrow("cannot be negative");
  });

  it("has no upper bound", () => {
    const loop = initLoop(scenario("mysteryCircle"));
    if (loop.specialGauge === undefined) throw new Error("missing gauge");
    for (let value = 0; value < 12; value += 1) {
      adjustSpecialGauge(loop.specialGauge, 1);
    }
    expect(loop.specialGauge.value).toBe(12);
  });

  it("carries the Cosmic Mythology gauge through judgment and time gap", () => {
    const configured: Scenario = {
      tragedySet: "cosmicMythology",
      mainPlot: "murderPlan",
      subPlots: [],
      cast: { boyStudent: "keyPerson" },
      incidents: [],
      loops: 2,
      daysPerLoop: 3,
    };
    const state = createGameState(configured);
    chooseInitialLeader(state, 0);
    continueFromTimeGap(state);
    if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
    adjustSpecialGauge(state.loop.specialGauge, 1);
    adjustSpecialGauge(state.loop.specialGauge, 1);
    expect(killCharacter(state, "boyStudent")).toBe(true);
    expect(settleGameFlow(state)).toMatchObject({
      result: "protagonistsLost",
    });
    expect(state.history[0].specialGauge).toEqual({
      value: 2,
      increasedThisLoop: true,
    });

    continueAfterLoopJudgment(state);
    expect(state.loop.specialGauge).toEqual({
      value: 2,
      increasedThisLoop: false,
    });
    continueFromTimeGap(state);
    expect(state.loop.specialGauge).toEqual({
      value: 2,
      increasedThisLoop: false,
    });
  });

  it("increases CM once for each optional or mandatory refusal", () => {
    const optional = goodwillState("cosmicMythology", {
      classRep: "killer",
    });
    optional.loop.charCounters.classRep.goodwill = 2;
    expect(resolveGoodwillAbility(optional, {
      user: "classRep",
      rank: 2,
    }, "refuse")).toMatchObject({ refused: true });
    expect(optional.loop.specialGauge).toEqual({
      value: 1,
      increasedThisLoop: true,
    });
    expect(optional.loop.phaseLog).toContainEqual(expect.objectContaining({
      kind: "goodwillUsed",
      response: "refuse",
      publicChanges: [{
        kind: "specialGauge",
        beforeValue: 0,
        afterValue: 1,
        delta: 1,
      }],
    }));

    const mandatory = goodwillState("cosmicMythology", {
      girlStudent: "witch",
      boyStudent: "person",
    });
    mandatory.loop.charCounters.girlStudent.goodwill = 2;
    expect(resolveGoodwillAbility(mandatory, {
      user: "girlStudent",
      rank: 2,
      target: "boyStudent",
    }, "resolve")).toMatchObject({ refused: true, response: "refuse" });
    expect(mandatory.loop.specialGauge).toEqual({
      value: 1,
      increasedThisLoop: true,
    });

    const observations = collectProtagonistObservations(optional);
    expect(observations).toEqual([
      expect.objectContaining({
        kind: "goodwillRefused",
        character: "classRep",
      }),
    ]);
  });

  it("does not add a CM gauge increase when refusal is impossible", () => {
    const nurse = goodwillState("cosmicMythology", {
      nurse: "killer",
      girlStudent: "person",
    });
    nurse.loop.charCounters.nurse.goodwill = 2;
    nurse.loop.charCounters.girlStudent.paranoia = 3;
    nurse.loop.board.girlStudent = { status: "alive", at: "Hospital" };
    expect(() => resolveGoodwillAbility(nurse, {
      user: "nurse",
      rank: 2,
      abilityIndex: 0,
      target: "girlStudent",
    }, "refuse")).toThrow("cannot be refused");
    expect(nurse.loop.specialGauge).toEqual({
      value: 0,
      increasedThisLoop: false,
    });

    const outsider = goodwillState("cosmicMythology", {
      mysteryBoy: "witch",
    }, 2);
    outsider.loop.charCounters.mysteryBoy.goodwill = 3;
    expect(() => resolveGoodwillAbility(outsider, {
      user: "mysteryBoy",
      rank: 3,
      abilityIndex: 1,
    }, "refuse")).toThrow("cannot be refused");
    expect(outsider.loop.specialGauge).toEqual({
      value: 0,
      increasedThisLoop: false,
    });
  });

  it("keeps increasedThisLoop true after scientist decreases the CM gauge", () => {
    const state = goodwillState("cosmicMythology", {
      scientist: "person",
    });
    state.loop.charCounters.scientist.goodwill = 3;
    if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
    adjustSpecialGauge(state.loop.specialGauge, 1);
    adjustSpecialGauge(state.loop.specialGauge, 1);

    expect(resolveGoodwillAbility(state, {
      user: "scientist",
      rank: 3,
      abilityIndex: 1,
      specialGaugeDelta: -1,
    }, "resolve")).toMatchObject({ resolved: true, effectApplied: true });
    expect(state.loop.specialGauge).toEqual({
      value: 1,
      increasedThisLoop: true,
    });
  });

  it("does not create a refusal gauge outside Cosmic Mythology", () => {
    const state = goodwillState("basicTragedy", {
      classRep: "killer",
    });
    state.loop.charCounters.classRep.goodwill = 2;
    resolveGoodwillAbility(state, {
      user: "classRep",
      rank: 2,
    }, "refuse");
    expect(state.loop.specialGauge).toBeUndefined();
  });

  it("describes loop and game lifetime gauges differently in the editor", () => {
    expect(renderScenarioEditor({
      draft: { tragedySet: "mysteryCircle" },
      step: 0,
    }, "")).toContain("초기값 0 · 루프마다 초기화");
    expect(renderScenarioEditor({
      draft: { tragedySet: "cosmicMythology" },
      step: 0,
    }, "")).toContain("초기값 0 · 루프 간 유지");
  });
});
