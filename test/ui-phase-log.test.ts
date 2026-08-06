import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  phaseLogGroupIsOpen,
  phaseLogGroups,
} from "../src/ui/phase-log";
import type {
  GameState,
  LoopState,
  PhaseLogEntry,
  Scenario,
} from "../src/types";

const scenario: Scenario = {
  tragedySet: "basicTragedy",
  mainPlot: "murderPlan",
  subPlots: [],
  cast: { boyStudent: "person" },
  incidents: [],
  loops: 3,
  daysPerLoop: 7,
};

function logEntries(loop: number): PhaseLogEntry[] {
  const entries: PhaseLogEntry[] = [];
  for (let day = 1; day <= 7; day += 1) {
    for (let index = 0; index < 9; index += 1) {
      const phase = ([
        "P1_ROUND_START",
        "P5_MASTERMIND_ABILITY",
        "P7_INCIDENT",
      ] as const)[index % 3];
      entries.push({ loop, day, phase, kind: "notApplicable" });
    }
  }
  return entries;
}

function loopState(loop: number): LoopState {
  const state = initLoop(scenario);
  state.loop = loop;
  state.day = 7;
  state.phaseLog = logEntries(loop);
  return state;
}

function createLongState(): GameState {
  const current = loopState(3);
  return {
    scenario,
    gamePhase: "ROUND",
    loop: current,
    history: [loopState(1), loopState(2)],
    loopOutcomes: [],
  };
}

describe("phase log groups", () => {
  it("puts the latest loop, day, and phase first and opens only today", () => {
    const state = createLongState();
    const groups = phaseLogGroups(state);

    expect(groups[0]).toMatchObject({
      loop: 3,
      day: 7,
      phase: "P7_INCIDENT",
    });
    expect(groups.at(-1)).toMatchObject({
      loop: 1,
      day: 1,
      phase: "P1_ROUND_START",
    });
    expect(groups.filter((group) => phaseLogGroupIsOpen(state, group)))
      .toHaveLength(3);
    expect(
      groups.filter((group) => phaseLogGroupIsOpen(state, group)).every(
        ({ loop, day }) => loop === 3 && day === 7,
      ),
    ).toBe(true);
  });

  it("groups 189 entries without dropping history or slowing rendering data", () => {
    const state = createLongState();
    const startedAt = performance.now();
    const groups = phaseLogGroups(state);
    const elapsed = performance.now() - startedAt;

    expect(groups.reduce((sum, group) => sum + group.entries.length, 0))
      .toBe(189);
    expect(groups).toHaveLength(63);
    expect(elapsed).toBeLessThan(100);
  });
});
