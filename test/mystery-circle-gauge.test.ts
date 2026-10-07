import { describe, expect, it } from "vitest";

import { resolveIncident } from "../src/engine/incident";
import { evaluateLoss } from "../src/engine/loss";
import {
  collectHooks,
  hookResolutionKey,
  resolveHooks,
} from "../src/engine/phases";
import { initLoop } from "../src/engine/setup";
import { PLOT_IMPL } from "../src/impl/plots";
import { ROLE_IMPL } from "../src/impl/roles";
import type {
  CharacterId,
  GameState,
  Hook,
  HookPoint,
  Scenario,
  Target,
} from "../src/types";
import { setBoardLocation } from "./helpers";

function scenario(
  mainPlot: string,
  cast: Scenario["cast"],
  incidents: Scenario["incidents"] = [],
): Scenario {
  return {
    tragedySet: "mysteryCircle",
    mainPlot,
    subPlots: [],
    cast,
    incidents,
    loops: 3,
    daysPerLoop: 3,
  };
}

function stateFor(
  mainPlot: string,
  cast: Scenario["cast"],
  incidents: Scenario["incidents"] = [],
): GameState {
  const script = scenario(mainPlot, cast, incidents);
  const loop = initLoop(script);
  for (const character of Object.keys(loop.board)) {
    setBoardLocation(loop, character, "City");
  }
  return {
    scenario: script,
    gamePhase: "ROUND",
    loop,
    history: [],
    loopOutcomes: [],
  };
}

function mandatoryTarget(
  state: GameState,
  phase: HookPoint,
  self: CharacterId,
  expectedHook: Hook,
  target: Target,
): Readonly<Record<string, Target>> {
  const index = collectHooks(state, phase).findIndex(
    (entry) => entry.self === self && entry.hook === expectedHook,
  );
  if (index < 0) throw new Error("mandatory hook not collected");
  return { [hookResolutionKey(phase, self, index)]: target };
}

describe("Mystery Circle gauge-referencing plots", () => {
  it("adds 1 after the per-loop reset when the previous loop ended at 2 or less", () => {
    const script = scenario(
      "isolatedInstitutionPsycho",
      { boyStudent: "person" },
    );
    const previous = initLoop(script);
    if (previous.specialGauge === undefined) throw new Error("missing gauge");
    previous.specialGauge.value = 2;
    const state: GameState = {
      scenario: script,
      gamePhase: "LOOP_COUNTER_SETUP",
      loop: initLoop(script, 2, previous),
      history: [structuredClone(previous)],
      loopOutcomes: [],
    };

    expect(state.loop.specialGauge?.value).toBe(0);
    resolveHooks(state, "LOOP_START");
    expect(state.loop.specialGauge?.value).toBe(1);
  });

  it("does not add the loop-start point on loop 1 or after a previous value of 3", () => {
    const script = scenario(
      "isolatedInstitutionPsycho",
      { boyStudent: "person" },
    );
    const firstLoop = stateFor(
      "isolatedInstitutionPsycho",
      { boyStudent: "person" },
    );
    resolveHooks(firstLoop, "LOOP_START");
    expect(firstLoop.loop.specialGauge?.value).toBe(0);

    const previous = initLoop(script);
    if (previous.specialGauge === undefined) throw new Error("missing gauge");
    previous.specialGauge.value = 3;
    const nextLoop: GameState = {
      scenario: script,
      gamePhase: "LOOP_COUNTER_SETUP",
      loop: initLoop(script, 2, previous),
      history: [structuredClone(previous)],
      loopOutcomes: [],
    };
    resolveHooks(nextLoop, "LOOP_START");
    expect(nextLoop.loop.specialGauge?.value).toBe(0);
  });

  it("evaluates both loop-end gauge loss boundaries", () => {
    const tightrope = stateFor("tightropePlan", { boyStudent: "person" });
    tightrope.loop.day = tightrope.scenario.daysPerLoop;
    tightrope.loop.phase = "P9_ROUND_END";
    if (tightrope.loop.specialGauge === undefined) throw new Error("missing gauge");
    tightrope.loop.specialGauge.value = 1;
    expect(evaluateLoss(tightrope)).toContainEqual(expect.objectContaining({
      id: "tightropePlan",
      met: true,
    }));
    tightrope.loop.specialGauge.value = 2;
    expect(evaluateLoss(tightrope).some(({ id }) => id === "tightropePlan"))
      .toBe(false);

    const quilt = stateFor("quiltIncidents", { boyStudent: "person" });
    quilt.loop.day = quilt.scenario.daysPerLoop;
    quilt.loop.phase = "P9_ROUND_END";
    if (quilt.loop.specialGauge === undefined) throw new Error("missing gauge");
    quilt.loop.specialGauge.value = 2;
    expect(evaluateLoss(quilt).some(({ id }) => id === "quiltIncidents"))
      .toBe(false);
    quilt.loop.specialGauge.value = 3;
    expect(evaluateLoss(quilt)).toContainEqual(expect.objectContaining({
      id: "quiltIncidents",
      met: true,
    }));
  });
});

describe("Mystery Circle gauge-referencing roles", () => {
  it("makes a same-location Poisoner target die once per loop at gauge 2", () => {
    const state = stateFor("", {
      scientist: "poisoner",
      boyStudent: "person",
      girlStudent: "person",
    });
    state.loop.phase = "P9_ROUND_END";
    if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
    state.loop.specialGauge.value = 2;
    const targets = mandatoryTarget(
      state,
      "P9_ROUND_END",
      "scientist",
      ROLE_IMPL.poisoner.hooks[0],
      { kind: "character", id: "boyStudent" },
    );

    resolveHooks(state, "P9_ROUND_END", undefined, targets);

    expect(state.loop.board.boyStudent.status).toBe("dead");
    expect(ROLE_IMPL.poisoner.hooks[0].when(state, "scientist")).toBe(false);
  });

  it("does nothing below Poisoner's gauge boundary and kills protagonists at 4", () => {
    const state = stateFor("", {
      scientist: "poisoner",
      boyStudent: "person",
    });
    state.loop.phase = "P9_ROUND_END";
    if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
    state.loop.specialGauge.value = 1;
    resolveHooks(state, "P9_ROUND_END");
    expect(state.loop.board.boyStudent.status).toBe("alive");

    state.loop.specialGauge.value = 4;
    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "poisoner",
      character: "scientist",
      met: true,
    }));
  });

  it("removes one paranoia from a chosen other character at gauge 1", () => {
    const state = stateFor("", {
      scientist: "therapist",
      boyStudent: "person",
      girlStudent: "person",
    });
    state.loop.phase = "P5_MASTERMIND_ABILITY";
    state.loop.charCounters.boyStudent.paranoia = 1;
    if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
    state.loop.specialGauge.value = 1;
    const targets = mandatoryTarget(
      state,
      "P5_MASTERMIND_ABILITY",
      "scientist",
      ROLE_IMPL.therapist.hooks[0],
      { kind: "character", id: "boyStudent" },
    );

    resolveHooks(state, "P5_MASTERMIND_ABILITY", undefined, targets);

    expect(state.loop.charCounters.boyStudent.paranoia).toBe(0);
  });

  it("does not activate Therapist while the gauge is 0", () => {
    const state = stateFor("", {
      scientist: "therapist",
      boyStudent: "person",
    });
    state.loop.phase = "P5_MASTERMIND_ABILITY";
    state.loop.charCounters.boyStudent.paranoia = 1;

    resolveHooks(state, "P5_MASTERMIND_ABILITY");

    expect(state.loop.charCounters.boyStudent.paranoia).toBe(1);
  });

  it("lets Private Investigator force an incident only while the gauge is 0", () => {
    const incidents = [{
      day: 1,
      incident: "murder",
      culprit: "boyStudent",
    }];
    const gaugeZero = stateFor("", {
      mysteryBoy: "privateInvestigator",
      boyStudent: "person",
      girlStudent: "person",
    }, incidents);
    gaugeZero.loop.phase = "P7_INCIDENT";
    gaugeZero.loop.charCounters.boyStudent.paranoia = 0;

    expect(resolveIncident(gaugeZero, { target: "girlStudent" }))
      .toMatchObject({ occurrences: [{ fired: true }] });

    const gaugeOne = stateFor("", {
      mysteryBoy: "privateInvestigator",
      boyStudent: "person",
      girlStudent: "person",
    }, incidents);
    gaugeOne.loop.phase = "P7_INCIDENT";
    gaugeOne.loop.charCounters.boyStudent.paranoia = 0;
    if (gaugeOne.loop.specialGauge === undefined) throw new Error("missing gauge");
    gaugeOne.loop.specialGauge.value = 1;

    expect(resolveIncident(gaugeOne, { target: "girlStudent" }))
      .toMatchObject({ occurrences: [{ fired: false }] });
  });
});

describe("Mystery Circle source scaffolds", () => {
  it("keeps the three gauge plot source hooks available", () => {
    expect(PLOT_IMPL.tightropePlan.hooks).toHaveLength(1);
    expect(PLOT_IMPL.quiltIncidents.hooks).toHaveLength(1);
    expect(PLOT_IMPL.isolatedInstitutionPsycho.hooks).toHaveLength(1);
  });
});
