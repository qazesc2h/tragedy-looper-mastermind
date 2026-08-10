import { describe, expect, it } from "vitest";

import { settleGameFlow } from "../src/engine/game";
import { requestLoopEnd } from "../src/engine/flow";
import { resolveHooks } from "../src/engine/phases";
import { initLoop } from "../src/engine/setup";
import { PLOT_IMPL } from "../src/impl/plots";
import { effectiveRole } from "../src/types";
import type {
  GameState,
  Hook,
  PlotId,
  Scenario,
} from "../src/types";
import { boardIsAlive, setBoardLife } from "./helpers";

const BOY = "boyStudent";
const GIRL = "girlStudent";

function createPlotState(plot: PlotId): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: [plot],
    cast: {
      [BOY]: "person",
      [GIRL]: "person",
    },
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
  };
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

function endLoop(state: GameState): void {
  state.gamePhase = "ROUND";
  delete state.result;
  requestLoopEnd(state, "lastDay");
  settleGameFlow(state);
}

function plotHook(plot: PlotId): Hook {
  const hook = PLOT_IMPL[plot]?.hooks[0];
  if (!hook) throw new Error(`missing hook for plot "${plot}"`);
  return hook;
}

describe("source hooks implemented elsewhere", () => {
  const sourceHooks: [PlotId, number][] = [
    ["lightAvenger", 0],
    ["placeProtect", 0],
    ["sealedItem", 0],
    ["signWithMe", 1],
    ["changeOfFuture", 0],
    ["giantTimeBomb", 0],
    ["paranoiaVirus", 0],
    ["hideousScript", 0],
  ];

  it.each(sourceHooks)(
    "%s hook %i stays disabled and safe as a source-only no-op",
    (plot, hookIndex) => {
      const state = createPlotState(plot);
      const sourceHook = PLOT_IMPL[plot].hooks[hookIndex];
      const before = structuredClone(state);

      expect(sourceHook.when(state, "")).toBe(false);
      expect(() => sourceHook.effect(state, "")).not.toThrow();
      expect(state).toEqual(before);
    },
  );

  it("keeps the firstSteps role additions and variable curmudgeon count", () => {
    expect(PLOT_IMPL.lightAvenger.addsRoles).toEqual({ brain: 1 });
    expect(PLOT_IMPL.placeProtect.addsRoles).toEqual({
      keyPerson: 1,
      cultist: 1,
    });
    expect(PLOT_IMPL.shadowRipper).toMatchObject({
      addsRoles: { conspiracyTheorist: 1, serialKiller: 1 },
      hooks: [],
    });
    expect(PLOT_IMPL.hideousScript.addsRoles).toEqual({
      conspiracyTheorist: 1,
      curmudgeon: [0, 2],
      friend: 1,
    });
  });

  it("uses effectiveRole for the paranoiaVirus threshold", () => {
    const state = createPlotState("paranoiaVirus");
    state.loop.charCounters[BOY].paranoia = 2;
    expect(effectiveRole(state, BOY)).toBe("person");

    state.loop.charCounters[BOY].paranoia = 3;
    expect(effectiveRole(state, BOY)).toBe("serialKiller");
  });

  it("does not mutate a person when paranoiaVirus is not active", () => {
    const state = createPlotState("unknownFactor");
    state.loop.charCounters[BOY].paranoia = 3;

    expect(effectiveRole(state, BOY)).toBe("person");
  });
});

describe("unsettlingRumor", () => {
  const hook = plotHook("unsettlingRumor");

  it("places 1 intrigue on the explicitly selected location and records use", () => {
    const state = createPlotState("unsettlingRumor");
    state.loop.phase = "P5_MASTERMIND_ABILITY";

    expect(hook.timesPerLoop).toBe(1);
    expect(hook.when(state, "")).toBe(true);
    hook.effect(state, "", { kind: "location", at: "Hospital" });

    expect(state.loop.locIntrigue.Hospital).toBe(1);
    expect(state.loop.locIntrigue.Shrine).toBe(0);
    expect(state.loop.abilitiesUsedThisLoop).toEqual([
      "unsettlingRumor:plot:0",
    ]);
    expect(hook.when(state, "")).toBe(false);
  });

  it("does not apply again after its once-per-loop use is spent", () => {
    const state = createPlotState("unsettlingRumor");
    state.loop.abilitiesUsedThisLoop.push("unsettlingRumor:plot:0");

    expect(hook.when(state, "")).toBe(false);
    expect(() =>
      hook.effect(state, "", { kind: "location", at: "School" })
    ).toThrow("already spent this loop");
    expect(state.loop.locIntrigue.School).toBe(0);
  });

  it("does not choose a location when the mastermind supplies no target", () => {
    const state = createPlotState("unsettlingRumor");

    expect(() => hook.effect(state, "")).toThrow(
      "requires a location target",
    );
    expect(state.loop.locIntrigue).toEqual({
      Hospital: 0,
      Shrine: 0,
      City: 0,
      School: 0,
    });
    expect(state.loop.abilitiesUsedThisLoop).toEqual([]);
  });
});

describe("threadsFate", () => {
  const hook = plotHook("threadsFate");

  it("adds 2 paranoia to every living character who had goodwill last loop", () => {
    const state = createPlotState("threadsFate");
    state.loop.charCounters[BOY].goodwill = 1;
    state.loop.charCounters[GIRL].goodwill = 3;
    setBoardLife(state.loop, GIRL, false);

    endLoop(state);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].charCounters[BOY].goodwill).toBe(1);
    expect(boardIsAlive(state.history[0], GIRL)).toBe(false);

    state.loop = initLoop(state.scenario);
    state.loop.loop = 2;

    expect(hook.when(state, "")).toBe(true);
    resolveHooks(state, "LOOP_START");

    expect(state.loop.charCounters[BOY].paranoia).toBe(2);
    expect(state.loop.charCounters[GIRL].paranoia).toBe(0);
  });

  it("does nothing in the first loop because no previous snapshot exists", () => {
    const state = createPlotState("threadsFate");
    state.loop.charCounters[BOY].goodwill = 2;

    expect(hook.when(state, "")).toBe(false);
    resolveHooks(state, "LOOP_START");

    expect(state.loop.charCounters[BOY].paranoia).toBe(0);
    expect(state.loop.charCounters[GIRL].paranoia).toBe(0);
  });

  it("uses only the last loop snapshot", () => {
    const state = createPlotState("threadsFate");
    state.loop.charCounters[BOY].goodwill = 1;
    endLoop(state);

    state.loop = initLoop(state.scenario);
    state.loop.loop = 2;
    endLoop(state);

    state.loop = initLoop(state.scenario);
    state.loop.loop = 3;

    expect(hook.when(state, "")).toBe(false);
    resolveHooks(state, "LOOP_START");
    expect(state.loop.charCounters[BOY].paranoia).toBe(0);
  });
});
