import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import { publicObservationContext } from "../src/engine/public-observation";
import { recordRoundEndPairs } from "../src/engine/round-evidence";
import {
  advanceGame,
  chooseInitialLeader,
  continueAfterLoopJudgment,
  continueFromTimeGap,
  createGameState,
} from "../src/engine/game";
import { loadScenarioCatalog } from "../src/scenario-catalog";
import {
  emptyTrackerStore,
  persistGameState,
  TRACKER_STORAGE_KEY,
  type LocalKeyValueStore,
  type TrackerStore,
} from "../src/ui/storage";
import {
  PHASE_ORDER,
  type GameState,
  type Phase,
  type PhaseLogEntry,
  type Scenario,
} from "../src/types";

class MeasuringStorage implements LocalKeyValueStore {
  private readonly values = new Map<string, string>();
  readonly sizes: number[] = [];

  get length(): number {
    return this.values.size;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
    if (key === TRACKER_STORAGE_KEY) this.sizes.push(value.length);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function phaseEntry(
  phase: Phase,
  loop: number,
  day: number,
  state: GameState,
): PhaseLogEntry {
  const common = { loop, day };
  const character = Object.keys(state.scenario.cast)[0] ?? "boyStudent";
  const publicContext = publicObservationContext(state.loop);
  const placements = [
    {
      card: "intriguePlus2" as const,
      target: { kind: "character" as const, id: character },
      owner: "mastermind" as const,
    },
    {
      card: "paranoiaPlus1" as const,
      target: { kind: "character" as const, id: character },
      owner: 0 as const,
    },
    {
      card: "goodwillPlus1" as const,
      target: { kind: "location" as const, at: "School" as const },
      owner: 1 as const,
    },
  ];
  switch (phase) {
    case "P1_ROUND_START":
      return { ...common, phase, kind: "phaseCompleted" };
    case "P2_MASTERMIND_ACTION":
      return { ...common, phase, kind: "cardsPlaced", placements };
    case "P3_PROTAGONIST_ACTION":
      return { ...common, phase, kind: "cardsPlaced", placements };
    case "P4_RESOLVE":
      return {
        ...common,
        phase,
        kind: "actionResolved",
        results: [
          "각본가 음모+2 적용",
          "주인공 불안+1 적용",
          "주인공 우호+1 적용",
        ],
        placements,
        publicContext,
        publicChanges: [{
          kind: "counter",
          target: { kind: "character", id: character },
          counter: "intrigue",
          delta: 2,
        }],
      };
    case "P5_MASTERMIND_ABILITY":
      return {
        ...common,
        phase,
        kind: "abilityActivated",
        character,
        description: "공개 관측 용량 회귀용 각본가 능력",
        publicContext,
        publicChanges: [{
          kind: "counter",
          target: { kind: "location", at: "Shrine" },
          counter: "intrigue",
          delta: 1,
        }],
      };
    case "P6_GOODWILL":
      return {
        ...common,
        phase,
        kind: "goodwillUsed",
        character,
        rank: 1,
        abilityIndex: 0,
        response: "resolve",
        effectApplied: true,
        publicContext,
        publicChanges: [],
      };
    case "P7_INCIDENT":
      return {
        ...common,
        phase,
        kind: "incidentJudged",
        incident: "murder",
        culprit: character,
        fired: false,
        effectApplied: false,
        failureReasons: ["insufficientParanoia"],
        publicContext,
      };
    case "P8_LEADER_PASS":
      return { ...common, phase, kind: "leaderPassed", from: 0, to: 1 };
    case "P9_ROUND_END":
      return { ...common, phase, kind: "roundEnded", loopEnded: false };
  }
}

function simulateStoredScenario(scenario: Scenario): {
  storage: MeasuringStorage;
  tracker: TrackerStore;
  state: GameState;
} {
  const storage = new MeasuringStorage();
  const tracker = emptyTrackerStore();
  const state: GameState = {
    scenario: structuredClone(scenario),
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };

  for (let loop = 1; loop <= scenario.loops; loop += 1) {
    state.loop = initLoop(scenario, loop);
    for (let day = 1; day <= scenario.daysPerLoop; day += 1) {
      for (const phase of PHASE_ORDER) {
        state.loop.day = day;
        state.loop.phase = phase;
        if (phase === "P9_ROUND_END") recordRoundEndPairs(state);
        state.loop.phaseLog?.push(phaseEntry(phase, loop, day, state));
        persistGameState(
          storage,
          tracker,
          "capacity-test",
          state,
          `loop-${loop}-day-${day}-${phase}`,
          new Date(Date.UTC(2026, 7, loop, day, PHASE_ORDER.indexOf(phase))),
        );
      }
    }
    state.history.push(structuredClone(state.loop));
    state.loopOutcomes.push({
      loop,
      day: scenario.daysPerLoop,
      reason: "lastDay",
      result: "protagonistsLost",
      losses: [{ key: "capacity", id: "capacity", ko: "용량", label: "용량" }],
    });
  }

  state.gamePhase = "GAME_OVER";
  persistGameState(storage, tracker, "capacity-test", state, "game-over");
  return { storage, tracker, state };
}

function continueLoopSetupIfNeeded(state: GameState): void {
  if (state.gamePhase === "LOOP_TIME_GAP") continueFromTimeGap(state);
}

function playStoredScenarioToGameOver(scenario: Scenario): {
  storage: MeasuringStorage;
  tracker: TrackerStore;
  state: GameState;
} {
  const storage = new MeasuringStorage();
  const tracker = emptyTrackerStore();
  const state = createGameState(scenario);
  chooseInitialLeader(state, 0);
  continueFromTimeGap(state);

  let saves = 0;
  while (state.gamePhase !== "GAME_OVER") {
    if (state.gamePhase === "ROUND") {
      if (
        state.loop.day === state.scenario.daysPerLoop &&
        state.loop.phase === "P9_ROUND_END"
      ) {
        state.loop.locIntrigue.Shrine = 2;
      }
      advanceGame(state);
    } else if (state.gamePhase === "LOOP_JUDGMENT") {
      continueAfterLoopJudgment(state);
      continueLoopSetupIfNeeded(state);
    } else {
      throw new Error(`unexpected game phase ${state.gamePhase}`);
    }
    saves += 1;
    if (saves > scenario.loops * scenario.daysPerLoop * 10) {
      throw new Error("storage scenario did not terminate");
    }
    expect(persistGameState(
      storage,
      tracker,
      "capacity-test",
      state,
      `actual-flow-${saves}`,
    )).toBe(true);
  }
  return { storage, tracker, state };
}

function jsonLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function storageBreakdown(tracker: TrackerStore): Record<string, number> {
  const game = tracker.games["capacity-test"];
  const loops = [...game.state.history, game.state.loop];
  return {
    total: jsonLength(tracker),
    history: jsonLength(game.state.history),
    publicTrace: jsonLength(loops.flatMap((loop) => [
      ...(loop.phaseLog ?? []),
      ...(loop.publicInformationThisLoop ?? []),
    ])),
    observationsByLoop: jsonLength(game.observationsByLoop),
    currentLoop: jsonLength(game.state.loop),
    loopOutcomes: jsonLength(game.state.loopOutcomes),
    scenario: jsonLength(game.state.scenario),
    roundEvidence: jsonLength(loops.flatMap((loop) =>
      loop.roundEvidence ?? []
    )),
  };
}

describe("localStorage capacity", () => {
  it("stores a complete 4-loop x 7-day scenario below the storage budget", () => {
    const candidate = loadScenarioCatalog()
      .flatMap((entry) => entry.difficulties)
      .find(({ scenario }) =>
        scenario.loops === 4 && scenario.daysPerLoop === 7
      );
    if (candidate === undefined) throw new Error("missing 4 x 7 scenario");

    const actualScenario: Scenario = {
      tragedySet: "firstSteps",
      mainPlot: "sealedItem",
      subPlots: [],
      cast: { boyStudent: "person" },
      incidents: [],
      loops: 4,
      daysPerLoop: 7,
    };
    const actual = playStoredScenarioToGameOver(actualScenario);
    const measured = simulateStoredScenario(candidate.scenario);
    console.info("storage-capacity 4x7", storageBreakdown(measured.tracker));

    expect(actual.state.gamePhase).toBe("GAME_OVER");
    expect(actual.state.history).toHaveLength(4);
    expect(actual.state.loopOutcomes).toHaveLength(4);
    expect(actual.storage.sizes.at(-1)).toBeLessThan(1_000_000);
    expect(measured.state.gamePhase).toBe("GAME_OVER");
    expect(measured.state.history).toHaveLength(4);
    expect(measured.storage.sizes).toHaveLength(4 * 7 * 9 + 1);
    expect(measured.storage.sizes.at(-1)).toBeLessThan(1_000_000);
    expect(jsonLength(measured.tracker.games["capacity-test"].observationsByLoop))
      .toBeLessThan(100_000);
    expect(measured.state.history.flatMap((loop) => loop.phaseLog ?? []))
      .toHaveLength(4 * 7 * 9);
  });

  it("stores the longest bundled difficulty below the storage budget", () => {
    const longest = loadScenarioCatalog()
      .flatMap((entry) => entry.difficulties.map((difficulty) => ({
        id: entry.id,
        scenario: difficulty.scenario,
        rounds: difficulty.numberOfLoops * difficulty.scenario.daysPerLoop,
      })))
      .sort((left, right) => right.rounds - left.rounds)[0];
    if (longest === undefined) throw new Error("missing bundled scenario");

    const measured = simulateStoredScenario(longest.scenario);
    console.info("storage-capacity longest", {
      id: longest.id,
      loops: longest.scenario.loops,
      days: longest.scenario.daysPerLoop,
      rounds: longest.rounds,
      ...storageBreakdown(measured.tracker),
    });

    expect(measured.state.gamePhase).toBe("GAME_OVER");
    expect(measured.state.history).toHaveLength(longest.scenario.loops);
    expect({
      loops: longest.scenario.loops,
      days: longest.scenario.daysPerLoop,
      rounds: longest.rounds,
    }).toEqual({ loops: 5, days: 7, rounds: 35 });
    expect(measured.storage.sizes.at(-1)).toBeLessThan(1_000_000);
    expect(JSON.stringify(measured.tracker)).not.toMatch(
      /hypothesisCache|rolePossibilityTable|incidentPossibilityTable/,
    );
  });
});
