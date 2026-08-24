import { describe, expect, it } from "vitest";

import { killCharacter, withDeathBatch } from "../src/engine/death";
import {
  advanceGame,
  createGameState,
  settleGameFlow,
} from "../src/engine/game";
import type { GameState, Scenario } from "../src/types";

function scenario(
  cast: Scenario["cast"],
  mainPlot = "murderPlan",
  subPlots: string[] = [],
): Scenario {
  return {
    tragedySet: "basicTragedy",
    mainPlot,
    subPlots,
    cast,
    incidents: [],
    loops: 2,
    daysPerLoop: 3,
  };
}

function roundState(script: Scenario): GameState {
  const state = createGameState(script);
  state.gamePhase = "ROUND";
  return state;
}

describe("round evidence", () => {
  it("records a no-death P9 pair with observation-time paranoia", () => {
    const state = roundState(scenario(
      { doctor: "serialKiller", patient: "timeTraveler" },
      "changeOfFuture",
      ["hiddenFreak"],
    ));
    state.loop.phase = "P9_ROUND_END";
    state.loop.board.doctor = { status: "alive", at: "Hospital" };
    state.loop.board.patient = { status: "alive", at: "Hospital" };
    state.loop.charCounters.doctor.paranoia = 3;
    state.loop.charCounters.patient.paranoia = 1;

    advanceGame(state);

    expect(state.loop.roundEvidence?.[0]).toEqual({
      day: 1,
      roundEndPairs: [{
        location: "Hospital",
        characters: ["doctor", "patient"],
        paranoia: [3, 1],
      }],
    });
    expect(state.loop.board.patient.status).toBe("alive");
  });

  it("links a P9 pair to its simultaneous round-end death batch", () => {
    const state = roundState(scenario(
      { doctor: "serialKiller", patient: "person" },
      "sealedItem",
      ["hiddenFreak"],
    ));
    state.loop.phase = "P9_ROUND_END";
    state.loop.board.doctor = { status: "alive", at: "City" };
    state.loop.board.patient = { status: "alive", at: "City" };
    state.loop.charCounters.doctor.paranoia = 2;
    state.loop.charCounters.patient.paranoia = 0;

    advanceGame(state);

    expect(state.loop.roundEvidence?.[0]).toEqual({
      day: 1,
      roundEndPairs: [{
        location: "City",
        characters: ["doctor", "patient"],
        paranoia: [2, 0],
      }],
      deathBatches: [{
        phase: "P9_ROUND_END",
        characters: ["patient"],
      }],
    });
    expect(state.loop.board.patient.status).toBe("dead");
  });

  it("keeps one simultaneous death batch and immediate keys in history", () => {
    const state = roundState(scenario({
      doctor: "person",
      patient: "keyPerson",
    }));
    state.loop.phase = "P4_RESOLVE";
    state.loop.board.doctor = { status: "alive", at: "Hospital" };
    state.loop.board.patient = { status: "alive", at: "School" };

    withDeathBatch(state, () => {
      expect(killCharacter(state, "doctor")).toBe(true);
      expect(killCharacter(state, "patient")).toBe(true);
    });

    expect(state.loop.pendingImmediateLossKeys).toEqual([
      "role:keyPerson:patient",
    ]);
    expect(state.loop.roundEvidence).toEqual([{
      day: 1,
      deathBatches: [{
        phase: "P4_RESOLVE",
        characters: ["doctor", "patient"],
      }],
    }]);

    settleGameFlow(state);

    expect(state.history[0]?.pendingImmediateLossKeys).toEqual([
      "role:keyPerson:patient",
    ]);
    expect(state.history[0]?.roundEvidence).toEqual([{
      day: 1,
      deathBatches: [{
        phase: "P4_RESOLVE",
        characters: ["doctor", "patient"],
      }],
      immediateLoopEnd: {
        phase: "P4_RESOLVE",
        reason: "effect",
      },
    }]);
    expect(state.loop.pendingImmediateLossKeys).toBeUndefined();
  });
});
