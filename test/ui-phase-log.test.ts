import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  phaseLogDayIsOpen,
  phaseLogLoopGroups,
  phaseLogLoopIsOpen,
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
        "P2_MASTERMIND_ACTION",
        "P3_PROTAGONIST_ACTION",
        "P4_RESOLVE",
        "P5_MASTERMIND_ABILITY",
        "P6_GOODWILL",
        "P7_INCIDENT",
        "P8_LEADER_PASS",
        "P9_ROUND_END",
      ] as const)[index];
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
  it("nests days under loops and opens only the current loop's today", () => {
    const state = createLongState();
    const groups = phaseLogLoopGroups(state);

    expect(groups[0]).toMatchObject({ loop: 3 });
    expect(groups[0]?.days[0]).toMatchObject({ day: 7 });
    expect(groups.at(-1)).toMatchObject({ loop: 1 });
    expect(groups.at(-1)?.days.at(-1)).toMatchObject({ day: 1 });
    expect(groups.filter((group) => phaseLogLoopIsOpen(state, group)))
      .toHaveLength(1);
    expect(groups.flatMap(({ days }) => days).filter(
      (group) => phaseLogDayIsOpen(state, group),
    )).toEqual([expect.objectContaining({ loop: 3, day: 7 })]);
  });

  it("groups 189 entries without dropping history or slowing rendering data", () => {
    const state = createLongState();
    const startedAt = performance.now();
    const groups = phaseLogLoopGroups(state);
    const elapsed = performance.now() - startedAt;

    expect(groups.reduce((loopSum, loopGroup) =>
      loopSum + loopGroup.days.reduce(
        (daySum, dayGroup) => daySum + dayGroup.entries.length,
        0,
      ), 0))
      .toBe(189);
    expect(groups).toHaveLength(3);
    expect(groups.every(({ days }) => days.length === 7)).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });
});
